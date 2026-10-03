-- Server-side counter for OTP login attempts. Login itself is Supabase OTP;
-- the Next server calls public.rpc_auth_attempt with the secret key before
-- each OTP request/verification and public.rpc_auth_attempt_reset after a
-- successful verification. Only sha256 hashes are stored (lowercased email or
-- client IP), never the values, and rows older than 24 hours are purged on
-- every call.
--
-- Limits (15-minute windows):
--   otp_request: 3 per email and 20 per IP (sliding window).
--   otp_verify:  5 attempts per email without a success in between, then a
--                15-minute block counted from the fifth. A success resets.
-- Blocked calls are not recorded, so a block always ends on time.
--
-- Not tenant data: there is no organization, so these calls have no audit row.

create table private.auth_attempts (
  id bigint generated always as identity primary key,
  key_hash bytea not null,
  kind text not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint auth_attempts_key_hash_check check (octet_length(key_hash) = 32),
  constraint auth_attempts_kind_check check (kind in ('otp_request', 'otp_verify'))
);

comment on table private.auth_attempts is
  'Hashed OTP attempt log for rate limiting (service_role only). Rows older than 24 hours are purged.';

create index auth_attempts_key_kind_created_at_idx
  on private.auth_attempts (key_hash, kind, created_at);
create index auth_attempts_created_at_idx on private.auth_attempts (created_at);

alter table private.auth_attempts enable row level security;
revoke all on table private.auth_attempts from public, anon, authenticated, service_role;

-- Seconds until a sliding window of p_window admits another attempt for
-- (p_key, p_kind) under p_limit, or 0 when it already does.
create function private.auth_window_retry_after(
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
  select coalesce((
    -- The oldest attempt that must expire before the count drops below p_limit.
    select greatest(1, ceil(extract(epoch from (attempt.created_at + p_window - p_now)))::integer)
    from private.auth_attempts as attempt
    where attempt.key_hash = p_key
      and attempt.kind = p_kind
      and attempt.created_at > p_now - p_window
    order by attempt.created_at desc
    offset p_limit - 1
    limit 1
  ), 0);
$$;

create function private.auth_attempt(p_kind text, p_email_hash bytea, p_ip_hash bytea)
returns table (allowed boolean, retry_after integer)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_retry integer := 0;
begin
  if p_kind is null or p_kind not in ('otp_request', 'otp_verify')
    or p_email_hash is null or octet_length(p_email_hash) <> 32
    or (p_ip_hash is not null and octet_length(p_ip_hash) <> 32)
    or (p_kind = 'otp_request' and p_ip_hash is null)
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- Serialize per key so parallel calls cannot all slip under a limit.
  -- Always email (1004) before IP (1005); never combined with other locks.
  perform pg_catalog.pg_advisory_xact_lock(1004, pg_catalog.hashtext(pg_catalog.encode(p_email_hash, 'hex')));
  if p_kind = 'otp_request' then
    perform pg_catalog.pg_advisory_xact_lock(1005, pg_catalog.hashtext(pg_catalog.encode(p_ip_hash, 'hex')));
  end if;

  delete from private.auth_attempts as expired
  where expired.created_at < v_now - interval '24 hours';

  if p_kind = 'otp_request' then
    v_retry := greatest(
      private.auth_window_retry_after(p_email_hash, 'otp_request', 3, interval '15 minutes', v_now),
      private.auth_window_retry_after(p_ip_hash, 'otp_request', 20, interval '15 minutes', v_now)
    );

    if v_retry > 0 then
      return query select false, v_retry;
      return;
    end if;

    insert into private.auth_attempts (key_hash, kind)
    values (p_email_hash, 'otp_request'), (p_ip_hash, 'otp_request');
  else
    -- Blocked calls are never recorded, so once five attempts fall within 15
    -- minutes the fifth is the newest row and the block runs 15 minutes from it.
    v_retry := private.auth_window_retry_after(p_email_hash, 'otp_verify', 5, interval '15 minutes', v_now);

    if v_retry > 0 then
      select greatest(1, ceil(extract(epoch from (pg_catalog.max(attempt.created_at) + interval '15 minutes' - v_now)))::integer)
      into v_retry
      from private.auth_attempts as attempt
      where attempt.key_hash = p_email_hash
        and attempt.kind = 'otp_verify';

      return query select false, v_retry;
      return;
    end if;

    insert into private.auth_attempts (key_hash, kind)
    values (p_email_hash, 'otp_verify');
  end if;

  return query select true, 0;
end;
$$;

create function private.auth_attempt_reset(p_email_hash bytea)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if p_email_hash is null or octet_length(p_email_hash) <> 32 then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1004, pg_catalog.hashtext(pg_catalog.encode(p_email_hash, 'hex')));

  delete from private.auth_attempts as attempt
  where attempt.key_hash = p_email_hash;
end;
$$;

create function public.rpc_auth_attempt(p_kind text, p_email_hash bytea, p_ip_hash bytea default null)
returns table (allowed boolean, retry_after integer)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.auth_attempt(p_kind, p_email_hash, p_ip_hash);
$$;

comment on function public.rpc_auth_attempt(text, bytea, bytea) is
  'service_role only: record an OTP attempt (sha256 hashes) and report whether it is allowed.';

create function public.rpc_auth_attempt_reset(p_email_hash bytea)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.auth_attempt_reset(p_email_hash);
$$;

comment on function public.rpc_auth_attempt_reset(bytea) is
  'service_role only: clear the attempt counters of an email hash after a successful verification.';

revoke all on function private.auth_window_retry_after(bytea, text, integer, interval, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.auth_attempt(text, bytea, bytea) from public, anon, authenticated, service_role;
revoke all on function private.auth_attempt_reset(bytea) from public, anon, authenticated, service_role;
revoke all on function public.rpc_auth_attempt(text, bytea, bytea) from public, anon, authenticated, service_role;
revoke all on function public.rpc_auth_attempt_reset(bytea) from public, anon, authenticated, service_role;

grant execute on function public.rpc_auth_attempt(text, bytea, bytea) to service_role;
grant execute on function public.rpc_auth_attempt_reset(bytea) to service_role;
