-- Kiosk fixes after security review (ADR 005).
--
-- 1. Pairing pause: 5000 failed codes in 15 minutes instead of 50. Guessing a
--    live code is already infeasible (40-bit codes, 10 minutes, one attempt at
--    a time under lock 1008), so a low global threshold only let anyone pause
--    pairing for every customer. The count stays visible to operators without
--    audit rows: rpc_kiosk_pairing_failures() (service_role) and a server-log
--    line (`raise log`) every 100 failures from 500 on.
-- 2. One lock order for every kiosk path:
--      1008 (pairing) | 1007 (PIN checks, per device)
--        -> kiosk_devices row -> kiosk_pairing_codes rows
--        -> 1003 (employee) -> 1002 (clock chain) -> 1001 (audit chain)
--    The PIN check now locks the device row right after 1007 and before any
--    audit row (the pause update used to come after an audit append, so a
--    concurrent revoke could deadlock). Pairing locks the device before its
--    code; issuing a new code locks the device first, like revoking. Purges
--    of old attempts skip rows another transaction holds.
-- 3. Calls during a lockout answer pin_locked silently: no audit row per call.
-- 4. A site_not_assigned race inside kiosk_clock answers pin_invalid.

-- Pairing ---------------------------------------------------------------------------------

create function private.kiosk_pairing_failures(p_now timestamptz)
returns integer
language sql
stable
set search_path = ''
as $$
  select pg_catalog.count(*)::integer
  from private.kiosk_attempts as attempt
  where attempt.kind = 'pair_failure'
    and attempt.created_at > p_now - interval '15 minutes';
$$;

create index kiosk_attempts_kind_created_at_idx on private.kiosk_attempts (kind, created_at);

-- Old attempts only matter for the 24-hour purge; never wait for a row
-- another kiosk call is purging too.
create function private.kiosk_purge_attempts(p_now timestamptz)
returns void
language sql
volatile
set search_path = ''
as $$
  delete from private.kiosk_attempts as expired
  where expired.id in (
    select old.id
    from private.kiosk_attempts as old
    where old.created_at < p_now - interval '24 hours'
    for update skip locked
  );
$$;

create or replace function private.kiosk_pair(p_code text)
returns table (ok boolean, error_code text, device_secret text, device_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_code text := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_code_hash bytea;
  v_device_id uuid;
  v_device public.kiosk_devices;
  v_failures integer;
  v_secret bytea;
begin
  -- Pairing is rare: one global lock keeps the pause count exact.
  perform pg_catalog.pg_advisory_xact_lock(1008, 0);
  v_now := pg_catalog.clock_timestamp();

  perform private.kiosk_purge_attempts(v_now);

  -- A safety valve, not the brute-force defence (see the header). Reaching it
  -- means someone is hammering the endpoint: operators watch the count.
  v_failures := private.kiosk_pairing_failures(v_now);
  if v_failures >= 5000 then
    return query select false, 'pairing_paused'::text, null::text, null::text;
    return;
  end if;

  if v_code ~ '^[A-HJ-NP-Z2-9]{8}$' then
    v_code_hash := extensions.digest(v_code, 'sha256');

    select code.device_id
    into v_device_id
    from private.kiosk_pairing_codes as code
    where code.code_hash = v_code_hash;

    -- Device row first, then its code (the order revoke and new codes use).
    if v_device_id is not null then
      select device.*
      into v_device
      from public.kiosk_devices as device
      where device.id = v_device_id
        and device.status = 'active'
      for update;

      perform 1
      from private.kiosk_pairing_codes as code
      where code.code_hash = v_code_hash
        and code.device_id = v_device_id
        and code.used_at is null
        and code.expires_at > v_now
      for update;

      if not found then
        v_device := null;
      end if;
    end if;
  end if;

  -- Unknown, used and expired codes look the same. No organization is known,
  -- so there is no audit row (like the auth limiter).
  if v_device.id is null then
    insert into private.kiosk_attempts (kind) values ('pair_failure');
    v_failures := v_failures + 1;
    if v_failures >= 500 and v_failures % 100 = 0 then
      raise log 'kiosk pairing: % failed codes in 15 minutes (pause at 5000)', v_failures;
    end if;
    return query select false, 'code_invalid'::text, null::text, null::text;
    return;
  end if;

  update private.kiosk_pairing_codes as code
  set used_at = v_now
  where code.code_hash = v_code_hash;

  delete from private.kiosk_pairing_codes as other
  where other.device_id = v_device.id
    and other.code_hash <> v_code_hash;

  -- Re-pairing replaces the secret: a tablet paired before stops working.
  v_secret := extensions.gen_random_bytes(32);
  update public.kiosk_devices as device
  set secret_hash = extensions.digest(v_secret, 'sha256'),
      last_seen_at = v_now,
      paused_until = null
  where device.id = v_device.id;

  perform private.write_kiosk_audit(
    v_device.organization_id,
    'kiosk.paired',
    'kiosk_device',
    v_device.id,
    pg_catalog.jsonb_build_object('device_id', v_device.id, 'site_id', v_device.site_id)
  );

  return query select true, null::text, pg_catalog.encode(v_secret, 'hex'), v_device.name;
end;
$$;

-- For monitoring (service_role): failed pairing codes in the last 15 minutes.
create function public.rpc_kiosk_pairing_failures()
returns table (failures integer, paused boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select counted.failures, counted.failures >= 5000
  from (select private.kiosk_pairing_failures(pg_catalog.clock_timestamp()) as failures) as counted;
$$;

comment on function public.rpc_kiosk_pairing_failures() is
  'service_role only: failed kiosk pairing codes in the last 15 minutes; pairing pauses at 5000.';

-- Device row before code rows, like revoke and pairing.
create or replace function private.kiosk_new_pairing_code(p_device_id uuid)
returns table (pairing_code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.kiosk_devices;
  v_code record;
begin
  select device.*
  into v_device
  from public.kiosk_devices as device
  where device.id = p_device_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.require_kiosk_admin(v_device.organization_id);

  select device.*
  into v_device
  from public.kiosk_devices as device
  where device.id = p_device_id
  for update;

  if v_device.status <> 'active' then
    raise exception using errcode = '22023', message = 'device_revoked';
  end if;

  select issued.o_code, issued.o_expires_at
  into v_code
  from private.kiosk_issue_code(v_device.organization_id, v_device.id) as issued;

  perform private.write_audit(
    v_device.organization_id,
    'kiosk.pairing_code_created',
    'kiosk_device',
    v_device.id,
    pg_catalog.jsonb_build_object('site_id', v_device.site_id)
  );

  return query select v_code.o_code, v_code.o_expires_at;
end;
$$;

-- PIN checks ------------------------------------------------------------------------------

create or replace function private.kiosk_verify_pin(
  p_device_secret text,
  p_employee_id uuid,
  p_pin text,
  out o_error text,
  out o_tries_left integer,
  out o_retry_after integer,
  out o_organization_id uuid,
  out o_site_id uuid,
  out o_device_id uuid
)
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_device public.kiosk_devices;
  v_now timestamptz;
  v_failures integer;
  v_last_failure timestamptz;
  v_device_failures integer;
  v_known boolean;
  v_eligible boolean;
  v_pin_hash text;
  v_reason text;
  v_metadata jsonb;
begin
  v_device := private.kiosk_device_for(p_device_secret);
  if v_device.id is null or p_employee_id is null then
    o_error := case when v_device.id is null then 'device_unknown' else 'invalid_input' end;
    return;
  end if;

  -- One PIN check at a time per device, so parallel guesses cannot all slip
  -- under a limit. Then the device row, before anything else is locked (see
  -- the header for the order); re-read, since a concurrent call may have
  -- paused or revoked the device meanwhile.
  perform pg_catalog.pg_advisory_xact_lock(1007, pg_catalog.hashtext(v_device.id::text));
  v_now := pg_catalog.clock_timestamp();

  select device.*
  into v_device
  from public.kiosk_devices as device
  where device.id = v_device.id
    and device.status = 'active'
  for update;

  if not found then
    o_error := 'device_unknown';
    return;
  end if;

  o_organization_id := v_device.organization_id;
  o_site_id := v_device.site_id;
  o_device_id := v_device.id;

  -- The pause itself was audited once; calls during it are not.
  if v_device.paused_until > v_now then
    o_error := 'device_paused';
    o_retry_after := greatest(1, ceil(extract(epoch from (v_device.paused_until - v_now))))::integer;
    return;
  end if;

  perform private.kiosk_purge_attempts(v_now);

  select pg_catalog.count(*), pg_catalog.max(attempt.created_at)
  into v_failures, v_last_failure
  from private.kiosk_attempts as attempt
  where attempt.kind = 'pin_failure'
    and attempt.device_id = v_device.id
    and attempt.employee_id = p_employee_id
    and attempt.created_at > v_now - interval '15 minutes';

  -- Blocked calls are neither recorded nor audited, so the fifth failure
  -- starts the block and a locked-out caller cannot flood the audit trail.
  if v_failures >= 5 then
    o_error := 'pin_locked';
    o_retry_after := greatest(1, ceil(extract(epoch from (v_last_failure + interval '15 minutes' - v_now))))::integer;
    return;
  end if;

  -- Only ids of this organization's employees go into its audit trail.
  v_known := exists (
    select 1
    from public.employees as employee
    where employee.id = p_employee_id
      and employee.organization_id = v_device.organization_id
  );
  v_metadata := pg_catalog.jsonb_build_object('device_id', v_device.id)
    || case when v_known then pg_catalog.jsonb_build_object('employee_id', p_employee_id) else '{}'::jsonb end;

  select pin.pin_hash
  into v_pin_hash
  from public.employees as employee
  join public.site_assignments as assignment
    on assignment.organization_id = employee.organization_id
   and assignment.employee_id = employee.id
   and assignment.site_id = v_device.site_id
  join public.sites as site
    on site.organization_id = assignment.organization_id
   and site.id = assignment.site_id
  left join public.employee_pins as pin
    on pin.employee_id = employee.id
  where employee.id = p_employee_id
    and employee.organization_id = v_device.organization_id
    and employee.active
    and site.active
    and not exists (
      select 1
      from public.memberships as membership
      where membership.organization_id = employee.organization_id
        and membership.user_id = employee.user_id
        and membership.status = 'suspended'
    );
  v_eligible := found;

  if v_pin_hash is not null and p_pin ~ '^[0-9]{4,6}$' then
    if extensions.crypt(p_pin, v_pin_hash) = v_pin_hash then
      return;
    end if;
    v_reason := 'wrong_pin';
  else
    perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 10));
    v_reason := case
      when not v_eligible then 'not_eligible'
      when v_pin_hash is null then 'no_pin'
      else 'bad_format'
    end;
  end if;

  insert into private.kiosk_attempts (kind, device_id, employee_id)
  values ('pin_failure', v_device.id, p_employee_id);
  v_failures := v_failures + 1;

  select pg_catalog.count(*)
  into v_device_failures
  from private.kiosk_attempts as attempt
  where attempt.kind = 'pin_failure'
    and attempt.device_id = v_device.id
    and attempt.created_at > v_now - interval '15 minutes';

  -- The row is already locked; the audit chain lock (1001) comes last.
  if v_device_failures >= 30 then
    update public.kiosk_devices as device
    set paused_until = v_now + interval '15 minutes'
    where device.id = v_device.id;
  end if;

  perform private.write_kiosk_audit(
    v_device.organization_id, 'kiosk.pin_failed', 'kiosk_device', v_device.id,
    v_metadata || pg_catalog.jsonb_build_object('reason', v_reason)
  );

  if v_device_failures >= 30 then
    perform private.write_kiosk_audit(
      v_device.organization_id, 'kiosk.device_paused', 'kiosk_device', v_device.id,
      pg_catalog.jsonb_build_object('device_id', v_device.id)
    );
    o_error := 'device_paused';
    o_retry_after := 900;
    return;
  end if;

  if v_failures >= 5 then
    o_error := 'pin_locked';
    o_retry_after := 900;
    return;
  end if;

  o_error := 'pin_invalid';
  o_tries_left := 5 - v_failures;
end;
$$;

create or replace function private.kiosk_clock(
  p_device_secret text,
  p_employee_id uuid,
  p_pin text,
  p_type text,
  p_idempotency_key uuid
)
returns table (
  ok boolean,
  error_code text,
  tries_left integer,
  retry_after integer,
  state text,
  occurred_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_check record;
  v_event public.clock_events;
  v_message text;
begin
  if p_type is null
    or p_type not in ('clock_in', 'clock_out', 'break_start', 'break_end')
    or p_idempotency_key is null
  then
    return query select false, 'invalid_input'::text, null::integer, null::integer,
      null::text, null::timestamptz;
    return;
  end if;

  select verified.*
  into v_check
  from private.kiosk_verify_pin(p_device_secret, p_employee_id, p_pin) as verified;

  if v_check.o_error is not null then
    return query select false, v_check.o_error, v_check.o_tries_left, v_check.o_retry_after,
      null::text, null::timestamptz;
    return;
  end if;

  begin
    v_event := private.append_live_event(
      v_check.o_organization_id,
      p_employee_id,
      v_check.o_site_id,
      p_type,
      p_idempotency_key,
      null,
      'kiosk',
      null,
      v_check.o_device_id
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message in ('invalid_transition', 'idempotency_key_reused', 'site_not_assigned') then
      -- site_not_assigned can only be a race (the assignment was removed after
      -- the PIN check): answer like any other employee who is not here.
      return query select false,
        case v_message
          when 'invalid_transition' then 'invalid_transition'
          when 'site_not_assigned' then 'pin_invalid'
          else 'invalid_input'
        end,
        null::integer, null::integer, null::text, null::timestamptz;
      return;
    end if;
    raise;
  end;

  return query select true, null::text, null::integer, null::integer,
    private.clock_state_after(v_event.type), v_event.occurred_at;
end;
$$;

revoke all on function private.kiosk_pairing_failures(timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_purge_attempts(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_pairing_failures() from public, anon, authenticated, service_role;
grant execute on function public.rpc_kiosk_pairing_failures() to service_role;
