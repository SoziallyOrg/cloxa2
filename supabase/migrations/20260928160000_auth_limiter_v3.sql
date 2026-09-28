-- Attempt limiter v3 (security re-review of limiter v2). See ADR 003.
--
--   otp_request  email + IP: 3 per 15 min; IP: 20 per 15 min; email: 10 per hour.
--                Keying the tight limit on the pair means a stranger's requests
--                only exhaust their own bucket, not the victim's.
--   otp_verify   flow (email + per-flow nonce): 5 failures, then blocked 15 min
--                from the fifth; IP: 30 per 15 min. The per-email ceiling is
--                gone: flows are already bounded by otp_request per email.
--   link_verify  a check only; the caller records failures afterwards with
--                rpc_auth_link_failure. IP: 30 failures per 15 min; everyone:
--                300 failures per 10 min, then link sign-in is paused (the
--                user types the code from the same email instead).
--   totp_verify  user: 5 failures, then blocked 15 min from the fifth.
--
-- A null IP hash (no trusted proxy header, or an unparsable one) skips every
-- IP-keyed rule instead of sharing one bucket among all unknown clients.
--
-- The v1 (three-argument) entry point and the v2 function are dropped: the
-- server only calls the four-argument RPC, whose result gains `paused`.
-- Hashes only, 24-hour purge, blocked calls are not recorded, no organization
-- (so no audit row), service_role only.

drop function public.rpc_auth_attempt(text, bytea, bytea);
drop function public.rpc_auth_attempt(text, bytea, bytea, bytea);
drop function private.auth_attempt(text, bytea, bytea);
drop function private.auth_attempt_v2(text, bytea, bytea, bytea);

-- The per-email verify ceiling no longer exists.
delete from private.auth_attempts where kind = 'otp_verify_email';

alter table private.auth_attempts drop constraint auth_attempts_kind_check;
alter table private.auth_attempts add constraint auth_attempts_kind_check check (
  kind in (
    -- Keyed on the email + IP pair and on the IP.
    'otp_request',
    'otp_request_email',
    -- Keyed on the flow hash.
    'otp_verify',
    'otp_verify_ip',
    -- Failed links only: per IP, and one shared global key.
    'link_verify',
    'link_verify_global',
    'totp_verify'
  )
);

-- The key of the global link-failure counter: no HMAC output is all zeroes.
create function private.auth_global_key()
returns bytea
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.decode(pg_catalog.repeat('00', 32), 'hex');
$$;

create function private.auth_attempt_v3(
  p_kind text,
  p_email_hash bytea,
  p_ip_hash bytea,
  p_subject_hash bytea
)
returns table (allowed boolean, retry_after integer, paused boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_retry integer := 0;
  v_global integer := 0;
begin
  if p_kind is null
    or p_kind not in ('otp_request', 'otp_verify', 'link_verify', 'totp_verify')
    or (p_email_hash is not null and octet_length(p_email_hash) <> 32)
    or (p_ip_hash is not null and octet_length(p_ip_hash) <> 32)
    or (p_subject_hash is not null and octet_length(p_subject_hash) <> 32)
    -- otp_request: the subject is the email + IP pair, so both or neither.
    or (p_kind = 'otp_request' and (p_email_hash is null or (p_ip_hash is null) <> (p_subject_hash is null)))
    or (p_kind = 'otp_verify' and (p_email_hash is null or p_subject_hash is null))
    or (p_kind = 'link_verify' and (p_email_hash is not null or p_subject_hash is not null))
    or (p_kind = 'totp_verify' and (p_subject_hash is null or p_email_hash is not null or p_ip_hash is not null))
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- Serialize per key so parallel calls cannot all slip under a limit. Fixed
  -- order: email/subject (1004, 1006) before IP (1005). link_verify only
  -- reads, so it takes no lock.
  if p_kind in ('otp_request', 'otp_verify') then
    perform pg_catalog.pg_advisory_xact_lock(1004, pg_catalog.hashtext(pg_catalog.encode(p_email_hash, 'hex')));
  end if;
  if p_kind = 'totp_verify' then
    perform pg_catalog.pg_advisory_xact_lock(1006, pg_catalog.hashtext(pg_catalog.encode(p_subject_hash, 'hex')));
  end if;
  if p_kind in ('otp_request', 'otp_verify') and p_ip_hash is not null then
    perform pg_catalog.pg_advisory_xact_lock(1005, pg_catalog.hashtext(pg_catalog.encode(p_ip_hash, 'hex')));
  end if;

  delete from private.auth_attempts as expired
  where expired.created_at < v_now - interval '24 hours';

  case p_kind
    when 'otp_request' then
      v_retry := private.auth_window_retry_after(p_email_hash, 'otp_request_email', 10, interval '1 hour', v_now);
      if p_ip_hash is not null then
        v_retry := greatest(
          v_retry,
          private.auth_window_retry_after(p_subject_hash, 'otp_request', 3, interval '15 minutes', v_now),
          private.auth_window_retry_after(p_ip_hash, 'otp_request', 20, interval '15 minutes', v_now)
        );
      end if;
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind) values (p_email_hash, 'otp_request_email');
        if p_ip_hash is not null then
          insert into private.auth_attempts (key_hash, kind)
          values (p_subject_hash, 'otp_request'), (p_ip_hash, 'otp_request');
        end if;
      end if;

    when 'otp_verify' then
      v_retry := private.auth_lockout_retry_after(p_subject_hash, 'otp_verify', 5, interval '15 minutes', v_now);
      if p_ip_hash is not null then
        v_retry := greatest(
          v_retry,
          private.auth_window_retry_after(p_ip_hash, 'otp_verify_ip', 30, interval '15 minutes', v_now)
        );
      end if;
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind) values (p_subject_hash, 'otp_verify');
        if p_ip_hash is not null then
          insert into private.auth_attempts (key_hash, kind) values (p_ip_hash, 'otp_verify_ip');
        end if;
      end if;

    when 'link_verify' then
      -- Nothing is recorded here: successes never count.
      v_global := private.auth_window_retry_after(
        private.auth_global_key(), 'link_verify_global', 300, interval '10 minutes', v_now
      );
      if p_ip_hash is not null then
        v_retry := private.auth_window_retry_after(p_ip_hash, 'link_verify', 30, interval '15 minutes', v_now);
      end if;
      v_retry := greatest(v_retry, v_global);

    when 'totp_verify' then
      v_retry := private.auth_lockout_retry_after(p_subject_hash, 'totp_verify', 5, interval '15 minutes', v_now);
      if v_retry = 0 then
        insert into private.auth_attempts (key_hash, kind) values (p_subject_hash, 'totp_verify');
      end if;
  end case;

  return query select v_retry = 0, v_retry, v_global > 0;
end;
$$;

comment on function private.auth_attempt_v3(text, bytea, bytea, bytea) is
  'Attempt limiter v3: checks (and, except for link_verify, records) an attempt; hashes only.';

create function private.auth_link_failure(p_ip_hash bytea)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_ip_hash is not null and octet_length(p_ip_hash) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  insert into private.auth_attempts (key_hash, kind)
  values (private.auth_global_key(), 'link_verify_global');
  if p_ip_hash is not null then
    insert into private.auth_attempts (key_hash, kind) values (p_ip_hash, 'link_verify');
  end if;
end;
$$;

comment on function private.auth_link_failure(bytea) is
  'Records one failed email-link verification: globally, and per IP when the IP is known.';

create function public.rpc_auth_attempt(
  p_kind text,
  p_email_hash bytea,
  p_ip_hash bytea,
  p_subject_hash bytea
)
returns table (allowed boolean, retry_after integer, paused boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.auth_attempt_v3(p_kind, p_email_hash, p_ip_hash, p_subject_hash);
$$;

comment on function public.rpc_auth_attempt(text, bytea, bytea, bytea) is
  'service_role only: check an attempt (otp_request with the email+IP pair, otp_verify with a flow hash, link_verify, totp_verify). `paused` means link sign-in is paused for everyone.';

create function public.rpc_auth_link_failure(p_ip_hash bytea)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.auth_link_failure(p_ip_hash);
$$;

comment on function public.rpc_auth_link_failure(bytea) is
  'service_role only: record a failed email-link verification (the IP hash may be null).';

revoke all on function private.auth_global_key() from public, anon, authenticated, service_role;
revoke all on function private.auth_attempt_v3(text, bytea, bytea, bytea)
  from public, anon, authenticated, service_role;
revoke all on function private.auth_link_failure(bytea) from public, anon, authenticated, service_role;
revoke all on function public.rpc_auth_attempt(text, bytea, bytea, bytea)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_auth_link_failure(bytea) from public, anon, authenticated, service_role;
grant execute on function public.rpc_auth_attempt(text, bytea, bytea, bytea) to service_role;
grant execute on function public.rpc_auth_link_failure(bytea) to service_role;
