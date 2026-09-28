-- Attempt limiter v2 (security review of the web auth flow).
--
-- The v1 otp_verify limit (5 failures per email, then a 15-minute block) let
-- anyone lock a known address out by typing wrong codes. v2 keys the tight
-- limit on one login flow instead, and adds wider ceilings:
--
--   otp_request  email: 3 per 15 min; IP: 20 per 15 min                    (unchanged)
--   otp_verify   flow (email + per-flow nonce): 5 failures, then blocked
--                15 min from the fifth; email: 20 per hour; IP: 30 per 15 min
--   link_verify  IP: 10 per 15 min (email links posted to /auth/confirm)
--   totp_verify  user: 5 failures, then blocked 15 min from the fifth
--                (never shares a key with the email)
--
-- A success still calls rpc_auth_attempt_reset(key), which clears every row
-- of that key hash. The v1 three-argument rpc_auth_attempt stays and now
-- delegates to v2: without a flow hash, otp_verify treats the email as the
-- flow (the v1 behaviour, plus the new ceilings).
--
-- Only keyed hashes are stored, rows older than 24 hours are purged on every
-- call, blocked calls are not recorded, and there is no organization (so no
-- audit row). service_role only.

alter table private.auth_attempts drop constraint auth_attempts_kind_check;
alter table private.auth_attempts add constraint auth_attempts_kind_check check (
  kind in (
    'otp_request',
    -- One row per verification attempt, keyed on the flow hash.
    'otp_verify',
    -- Ceilings recorded alongside each otp_verify row.
    'otp_verify_email',
    'otp_verify_ip',
    'link_verify',
    'totp_verify'
  )
);

-- Seconds until a "p_limit failures, then blocked p_window from the last one"
-- rule admits another attempt for (p_key, p_kind), or 0.
create function private.auth_lockout_retry_after(
  p_key bytea,
  p_kind text,
  p_limit integer,
  p_window interval,
  p_now timestamptz
)
returns integer
language sql
stable
set search_path = ''
as $$
  -- Blocked calls are never recorded, so once p_limit attempts fall within
  -- p_window the newest of them starts the block.
  select case
    when private.auth_window_retry_after(p_key, p_kind, p_limit, p_window, p_now) = 0 then 0
    else (
      select greatest(1, ceil(extract(epoch from (pg_catalog.max(attempt.created_at) + p_window - p_now)))::integer)
      from private.auth_attempts as attempt
      where attempt.key_hash = p_key
        and attempt.kind = p_kind
    )
  end;
$$;

create function private.auth_attempt_v2(
  p_kind text,
  p_email_hash bytea,
  p_ip_hash bytea,
  p_subject_hash bytea
)
returns table (allowed boolean, retry_after integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_retry integer := 0;
  v_flow bytea;
begin
  if p_kind is null
    or p_kind not in ('otp_request', 'otp_verify', 'link_verify', 'totp_verify')
    or (p_email_hash is not null and octet_length(p_email_hash) <> 32)
    or (p_ip_hash is not null and octet_length(p_ip_hash) <> 32)
    or (p_subject_hash is not null and octet_length(p_subject_hash) <> 32)
    or (p_kind = 'otp_request' and (p_email_hash is null or p_ip_hash is null or p_subject_hash is not null))
    or (p_kind = 'otp_verify' and p_email_hash is null)
    or (p_kind = 'link_verify' and (p_ip_hash is null or p_email_hash is not null or p_subject_hash is not null))
    or (p_kind = 'totp_verify' and (p_subject_hash is null or p_email_hash is not null))
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- Serialize per key so parallel calls cannot all slip under a limit. Fixed
  -- order: email/subject (1004, 1006) before IP (1005).
  if p_email_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(1004, pg_catalog.hashtext(pg_catalog.encode(p_email_hash, 'hex')));
  end if;
  if p_kind = 'totp_verify' then
    perform pg_catalog.pg_advisory_xact_lock(1006, pg_catalog.hashtext(pg_catalog.encode(p_subject_hash, 'hex')));
  end if;
  if p_ip_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(1005, pg_catalog.hashtext(pg_catalog.encode(p_ip_hash, 'hex')));
  end if;

  delete from private.auth_attempts as expired
  where expired.created_at < v_now - interval '24 hours';

  case p_kind
    when 'otp_request' then
      v_retry := greatest(
        private.auth_window_retry_after(p_email_hash, 'otp_request', 3, interval '15 minutes', v_now),
        private.auth_window_retry_after(p_ip_hash, 'otp_request', 20, interval '15 minutes', v_now)
      );
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind)
        values (p_email_hash, 'otp_request'), (p_ip_hash, 'otp_request');
      end if;

    when 'otp_verify' then
      v_flow := coalesce(p_subject_hash, p_email_hash);
      v_retry := greatest(
        private.auth_lockout_retry_after(v_flow, 'otp_verify', 5, interval '15 minutes', v_now),
        private.auth_window_retry_after(p_email_hash, 'otp_verify_email', 20, interval '1 hour', v_now),
        case
          when p_ip_hash is null then 0
          else private.auth_window_retry_after(p_ip_hash, 'otp_verify_ip', 30, interval '15 minutes', v_now)
        end
      );
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind)
        values (v_flow, 'otp_verify'), (p_email_hash, 'otp_verify_email');
        if p_ip_hash is not null then
          insert into private.auth_attempts (key_hash, kind) values (p_ip_hash, 'otp_verify_ip');
        end if;
      end if;

    when 'link_verify' then
      v_retry := private.auth_window_retry_after(p_ip_hash, 'link_verify', 10, interval '15 minutes', v_now);
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind) values (p_ip_hash, 'link_verify');
      end if;

    when 'totp_verify' then
      v_retry := private.auth_lockout_retry_after(p_subject_hash, 'totp_verify', 5, interval '15 minutes', v_now);
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind) values (p_subject_hash, 'totp_verify');
      end if;
  end case;

  return query select v_retry = 0, v_retry;
end;
$$;

comment on function private.auth_attempt_v2(text, bytea, bytea, bytea) is
  'Attempt limiter v2: records an allowed attempt (hashes only) and reports whether it is allowed.';

-- v1 entry point: same signature, now the v2 rules.
create or replace function private.auth_attempt(p_kind text, p_email_hash bytea, p_ip_hash bytea)
returns table (allowed boolean, retry_after integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.auth_attempt_v2(p_kind, p_email_hash, p_ip_hash, null);
$$;

-- No default on p_subject_hash: calls with two or three arguments keep
-- resolving to the v1 wrapper, calls with all four to this one.
create function public.rpc_auth_attempt(
  p_kind text,
  p_email_hash bytea,
  p_ip_hash bytea,
  p_subject_hash bytea
)
returns table (allowed boolean, retry_after integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.auth_attempt_v2(p_kind, p_email_hash, p_ip_hash, p_subject_hash);
$$;

comment on function public.rpc_auth_attempt(text, bytea, bytea, bytea) is
  'service_role only: record an attempt (otp_request, otp_verify with a flow hash, link_verify, totp_verify) and report whether it is allowed.';

revoke all on function private.auth_lockout_retry_after(bytea, text, integer, interval, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.auth_attempt_v2(text, bytea, bytea, bytea)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_auth_attempt(text, bytea, bytea, bytea)
  from public, anon, authenticated, service_role;
grant execute on function public.rpc_auth_attempt(text, bytea, bytea, bytea) to service_role;
