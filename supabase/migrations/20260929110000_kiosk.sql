-- Kiosk: a shared tablet per site (ADR 005).
--
-- Pairing: an owner or admin (fresh MFA) creates a kiosk for one site and
-- gets a one-time 8-character code, valid 10 minutes. The tablet exchanges it
-- (rpc_kiosk_pair, anon) for a 256-bit device secret; only sha256(secret) is
-- stored. Every kiosk RPC takes that secret; the device decides the
-- organization and the site. There is no Supabase session and no service key.
--
-- Identify: employees assigned to the site pick their name and enter a 4-6
-- digit PIN, stored as crypt(pin, gen_salt('bf', 10)).
--
-- Limits (private.kiosk_attempts, same shape as private.auth_attempts: rows
-- older than 24 hours are purged, blocked calls are not recorded):
--   * 5 wrong PINs per employee per device in 15 minutes lock that employee
--     on that device for 15 minutes from the fifth;
--   * 30 wrong PINs per device in 15 minutes pause the device for 15 minutes;
--   * 50 failed pairing codes in 15 minutes (globally: anon has no org) pause
--     pairing for everyone until the window clears.
-- Refusals are returned as rows, not raised, so the failure record and its
-- audit row survive. Anon callers only ever see uniform codes: whether an
-- employee exists, is at this site or has a PIN all look like `pin_invalid`.
--
-- Kiosk clock events: source 'kiosk', device_id = the kiosk, actor_user_id
-- null (a CHECK allows that only for kiosk events). Their audit rows have a
-- null actor and metadata.device_id. The live transition rules and lock
-- order are shared with rpc_clock through private.append_live_event.
--
-- Lock order: 1008 (pairing, global) and 1007 (PIN checks, per device) come
-- first, then 1003 (employee) -> 1002 (clock chain) -> 1001 (audit chain).
-- 1007 and 1008 are never taken together.

-- clock_events: kiosk events may have no actor ------------------------------------------

-- The canonical bytes already coalesce actor_user_id, so existing hashes are
-- unaffected and a null actor hashes as an empty field.
alter table public.clock_events alter column actor_user_id drop not null;

alter table public.clock_events
  add constraint clock_events_actor_check
    check (actor_user_id is not null or (source = 'kiosk' and device_id is not null));

comment on column public.clock_events.actor_user_id is
  'The signed-in user who recorded the event; null only for kiosk events (device_id names the kiosk).';

-- Tables ----------------------------------------------------------------------------------

create table public.kiosk_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  site_id uuid not null,
  name text not null,
  -- sha256 of the device secret; null until paired and after revocation.
  secret_hash bytea,
  status text not null default 'active',
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz,
  paused_until timestamptz,
  constraint kiosk_devices_organization_id_id_key unique (organization_id, id),
  constraint kiosk_devices_secret_hash_key unique (secret_hash),
  constraint kiosk_devices_site_fkey
    foreign key (organization_id, site_id)
    references public.sites (organization_id, id) on delete restrict,
  constraint kiosk_devices_name_check check (btrim(name) <> '' and char_length(name) <= 100),
  constraint kiosk_devices_status_check check (status in ('active', 'revoked')),
  constraint kiosk_devices_secret_hash_check
    check (secret_hash is null or octet_length(secret_hash) = 32),
  constraint kiosk_devices_revoked_secret_check check (status = 'active' or secret_hash is null)
);

comment on table public.kiosk_devices is
  'Shared tablets, one site each (ADR 005). secret_hash is never granted to an API role.';

create index kiosk_devices_organization_site_idx on public.kiosk_devices (organization_id, site_id);

create table private.kiosk_pairing_codes (
  code_hash bytea primary key,
  organization_id uuid not null,
  device_id uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at timestamptz,
  constraint kiosk_pairing_codes_device_fkey
    foreign key (organization_id, device_id)
    references public.kiosk_devices (organization_id, id) on delete cascade,
  constraint kiosk_pairing_codes_code_hash_check check (octet_length(code_hash) = 32)
);

create index kiosk_pairing_codes_device_id_idx on private.kiosk_pairing_codes (device_id);

create table public.employee_pins (
  employee_id uuid primary key,
  organization_id uuid not null,
  pin_hash text not null,
  set_by uuid not null,
  set_at timestamptz not null default clock_timestamp(),
  constraint employee_pins_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  -- crypt(pin, gen_salt('bf', 10)) and nothing else.
  constraint employee_pins_pin_hash_check check (pin_hash ~ '^\$2a\$10\$[./A-Za-z0-9]{53}$')
);

comment on table public.employee_pins is
  'Kiosk PINs (bcrypt, cost 10). pin_hash is never granted to an API role.';

create table private.kiosk_attempts (
  id bigint generated always as identity primary key,
  kind text not null,
  -- Not foreign keys: the employee id comes from an anonymous caller.
  device_id uuid,
  employee_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint kiosk_attempts_kind_check check (kind in ('pair_failure', 'pin_failure')),
  constraint kiosk_attempts_subject_check check (
    case kind
      when 'pair_failure' then device_id is null and employee_id is null
      else device_id is not null and employee_id is not null
    end
  )
);

comment on table private.kiosk_attempts is
  'Failed kiosk pairings and PIN checks, for rate limiting. Rows older than 24 hours are purged.';

create index kiosk_attempts_device_employee_idx
  on private.kiosk_attempts (device_id, employee_id, created_at);
create index kiosk_attempts_created_at_idx on private.kiosk_attempts (created_at);

alter table public.kiosk_devices enable row level security;
alter table public.employee_pins enable row level security;
alter table private.kiosk_pairing_codes enable row level security;
alter table private.kiosk_attempts enable row level security;

revoke all on table public.kiosk_devices from public, anon, authenticated, service_role;
revoke all on table public.employee_pins from public, anon, authenticated, service_role;
revoke all on table private.kiosk_pairing_codes from public, anon, authenticated, service_role;
revoke all on table private.kiosk_attempts from public, anon, authenticated, service_role;

-- Column grants: the hashes stay unreadable for every API role.
grant select (id, organization_id, site_id, name, status, created_by, created_at, last_seen_at, paused_until)
  on public.kiosk_devices to authenticated, service_role;
grant select (employee_id, organization_id, set_by, set_at)
  on public.employee_pins to authenticated, service_role;

-- Owners and admins (fresh MFA) see every kiosk of the org, managers those of
-- the sites they manage.
create policy kiosk_devices_select_privileged
on public.kiosk_devices
for select
to authenticated
using (
  private.is_privileged(organization_id)
  and (
    (private.current_membership(organization_id)).role in ('owner', 'admin')
    or exists (
      select 1
      from public.site_assignments as managed
      where managed.organization_id = kiosk_devices.organization_id
        and managed.site_id = kiosk_devices.site_id
        and managed.membership_id = (private.current_membership(kiosk_devices.organization_id)).id
    )
  )
);

-- Whether a PIN is set (never the hash): the employee and whoever sees them.
create policy employee_pins_select_visible
on public.employee_pins
for select
to authenticated
using (private.can_see_employee(employee_id));

-- Helpers ---------------------------------------------------------------------------------

-- PIN rules, mirrored in apps/web/src/lib/kiosk/pin.ts: 4-6 ASCII digits, not
-- all the same digit and not a straight run up or down (1234, 6543, 012345).
-- Returns the error code, or null when the PIN is acceptable.
create function private.pin_problem(p_pin text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_up boolean := true;
  v_down boolean := true;
  v_previous integer;
  v_digit integer;
begin
  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' then
    return 'pin_invalid_format';
  end if;

  for v_position in 2 .. char_length(p_pin) loop
    v_previous := substr(p_pin, v_position - 1, 1)::integer;
    v_digit := substr(p_pin, v_position, 1)::integer;
    v_up := v_up and v_digit = v_previous + 1;
    v_down := v_down and v_digit = v_previous - 1;
  end loop;

  if v_up or v_down or p_pin ~ '^(.)\1*$' then
    return 'pin_too_simple';
  end if;

  return null;
end;
$$;

-- 8 characters from an alphabet without I, O, 0 and 1: 32 symbols, so each
-- random byte masked to 5 bits picks one without bias (40 bits per code).
create function private.kiosk_new_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.string_agg(
    substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (pg_catalog.get_byte(random.bytes, position.n) & 31) + 1, 1),
    '' order by position.n
  )
  from (select extensions.gen_random_bytes(8) as bytes) as random
  cross join pg_catalog.generate_series(0, 7) as position (n);
$$;

-- Replaces every outstanding code of the device with a fresh one (10 minutes).
create function private.kiosk_issue_code(
  p_organization_id uuid,
  p_device_id uuid,
  out o_code text,
  out o_expires_at timestamptz
)
language plpgsql
volatile
set search_path = ''
as $$
begin
  delete from private.kiosk_pairing_codes as stale
  where stale.device_id = p_device_id
     or stale.expires_at < pg_catalog.clock_timestamp() - interval '1 day';

  o_expires_at := pg_catalog.clock_timestamp() + interval '10 minutes';
  loop
    o_code := private.kiosk_new_code();
    insert into private.kiosk_pairing_codes (code_hash, organization_id, device_id, expires_at)
    values (extensions.digest(o_code, 'sha256'), p_organization_id, p_device_id, o_expires_at)
    on conflict (code_hash) do nothing;
    exit when found;
  end loop;
end;
$$;

-- The active device for a secret (64 lowercase hex characters), or a null row.
create function private.kiosk_device_for(p_device_secret text)
returns public.kiosk_devices
language sql
stable
set search_path = ''
as $$
  select device.*
  from public.kiosk_devices as device
  where device.status = 'active'
    and device.secret_hash = case
      when p_device_secret ~ '^[0-9a-f]{64}$'
        then extensions.digest(pg_catalog.decode(p_device_secret, 'hex'), 'sha256')
    end;
$$;

create function private.name_initials(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.upper(pg_catalog.string_agg(pg_catalog.left(part.word, 1), '' order by part.n)), '')
  from pg_catalog.regexp_split_to_table(btrim(p_name), '\s+') with ordinality as part (word, n)
  where part.n <= 2 and part.word <> '';
$$;

-- Audit rows written for a kiosk: no user acted, whatever JWT the call carried.
create function private.write_kiosk_audit(
  p_organization_id uuid,
  p_action text,
  p_entity text,
  p_entity_id uuid,
  p_metadata jsonb
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.audit_log (organization_id, actor_user_id, action, entity, entity_id, metadata)
  values (p_organization_id, null, p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_id;

  return v_id;
end;
$$;

create function private.require_kiosk_admin(p_organization_id uuid)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
begin
  v_membership := private.require_privileged(p_organization_id);
  if v_membership.role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;
  return v_membership;
end;
$$;

-- Shared live clocking ----------------------------------------------------------------------

-- The live append shared by rpc_clock (source 'app') and the kiosk: per-employee
-- lock, idempotent replay, site assignment, transition rules, insert, audit.
-- Callers have already decided who the employee is.
create function private.append_live_event(
  p_organization_id uuid,
  p_employee_id uuid,
  p_site_id uuid,
  p_type text,
  p_idempotency_key uuid,
  p_client_captured_at timestamptz,
  p_source text,
  p_actor_user_id uuid,
  p_device_id uuid
)
returns public.clock_events
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_existing public.clock_events;
  v_last public.clock_events;
  v_state text;
  v_event public.clock_events;
  v_now timestamptz;
  v_metadata jsonb;
begin
  if p_source is null or p_source not in ('app', 'kiosk') then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(p_employee_id::text));

  -- Idempotent replay: checked under the employee lock, so a concurrent retry
  -- waits for the first attempt and then returns its event.
  select event.*
  into v_existing
  from public.clock_events as event
  where event.organization_id = p_organization_id
    and event.employee_id = p_employee_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.type <> p_type or v_existing.site_id <> p_site_id then
      raise exception using errcode = '22023', message = 'idempotency_key_reused';
    end if;
    return v_existing;
  end if;

  if not exists (
    select 1
    from public.site_assignments as assignment
    join public.sites as site
      on site.organization_id = assignment.organization_id
     and site.id = assignment.site_id
    where assignment.organization_id = p_organization_id
      and assignment.site_id = p_site_id
      and assignment.employee_id = p_employee_id
      and site.active
  ) then
    raise exception using errcode = '42501', message = 'site_not_assigned';
  end if;

  v_last := private.last_effective_event(p_organization_id, p_employee_id);
  v_state := private.clock_state_after(v_last.type);

  if not (
    (p_type = 'clock_in' and v_state = 'off')
    or (p_type in ('clock_out', 'break_start') and v_state = 'working')
    or (p_type = 'break_end' and v_state = 'on_break')
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'invalid_transition',
      detail = pg_catalog.format('state=%s type=%s', v_state, p_type);
  end if;

  -- The append trigger re-stamps both with the post-lock clock_timestamp().
  v_now := pg_catalog.clock_timestamp();

  insert into public.clock_events (
    organization_id,
    site_id,
    employee_id,
    type,
    occurred_at,
    server_at,
    client_captured_at,
    source,
    device_id,
    actor_user_id,
    idempotency_key
  )
  values (
    p_organization_id,
    p_site_id,
    p_employee_id,
    p_type,
    v_now,
    v_now,
    p_client_captured_at,
    p_source,
    p_device_id,
    p_actor_user_id,
    p_idempotency_key
  )
  returning * into v_event;

  v_metadata := pg_catalog.jsonb_build_object(
    'employee_id', p_employee_id,
    'site_id', p_site_id,
    'type', p_type,
    'source', p_source
  );

  if p_source = 'kiosk' then
    perform private.write_kiosk_audit(
      p_organization_id,
      'clock_event.recorded',
      'clock_event',
      v_event.id,
      v_metadata || pg_catalog.jsonb_build_object('device_id', p_device_id)
    );
  else
    perform private.write_audit(p_organization_id, 'clock_event.recorded', 'clock_event', v_event.id, v_metadata);
  end if;

  return v_event;
end;
$$;

-- Same checks, codes and order as before; the append itself is shared.
create or replace function private.clock(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz default null
)
returns public.clock_events
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_employee_id uuid;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- void and correction events are appended only by correction approval.
  if p_type is null or p_type not in ('clock_in', 'clock_out', 'break_start', 'break_end') then
    raise exception using errcode = '22023', message = 'invalid_clock_type';
  end if;

  if p_idempotency_key is null or p_site_id is null then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  -- The offline queue may hold an event for up to 3 days; allow 5 minutes of
  -- device clock skew into the future. Rejects +/-infinity too.
  if p_client_captured_at is not null and (
    p_client_captured_at < pg_catalog.now() - interval '72 hours'
    or p_client_captured_at > pg_catalog.now() + interval '5 minutes'
  ) then
    raise exception using errcode = '22023', message = 'client_time_out_of_range';
  end if;

  -- The site decides the organization; the employee row is always the
  -- caller's own. Unknown sites and foreign orgs look identical.
  select site.organization_id
  into v_organization_id
  from public.sites as site
  where site.id = p_site_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select employee.id
  into v_employee_id
  from public.employees as employee
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  where employee.organization_id = v_organization_id
    and employee.user_id = v_user_id
    and employee.active
    and membership.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return private.append_live_event(
    v_organization_id,
    v_employee_id,
    p_site_id,
    p_type,
    p_idempotency_key,
    p_client_captured_at,
    'app',
    v_user_id,
    null
  );
end;
$$;

-- Privileged: kiosks (owners and admins) --------------------------------------------------

create function private.kiosk_create(p_site_id uuid, p_name text)
returns table (device_id uuid, pairing_code text, expires_at timestamptz)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_site public.sites;
  v_name text := btrim(p_name);
  v_device_id uuid;
  v_code record;
begin
  select site.*
  into v_site
  from public.sites as site
  where site.id = p_site_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.require_kiosk_admin(v_site.organization_id);

  if not v_site.active then
    raise exception using errcode = '22023', message = 'site_inactive';
  end if;

  if v_name is null or v_name = '' or char_length(v_name) > 100 then
    raise exception using errcode = '22023', message = 'invalid_name';
  end if;

  insert into public.kiosk_devices (organization_id, site_id, name, created_by)
  values (v_site.organization_id, p_site_id, v_name, (select auth.uid()))
  returning id into v_device_id;

  select issued.o_code, issued.o_expires_at
  into v_code
  from private.kiosk_issue_code(v_site.organization_id, v_device_id) as issued;

  perform private.write_audit(
    v_site.organization_id,
    'kiosk.created',
    'kiosk_device',
    v_device_id,
    pg_catalog.jsonb_build_object('site_id', p_site_id)
  );

  return query select v_device_id, v_code.o_code, v_code.o_expires_at;
end;
$$;

create function private.kiosk_new_pairing_code(p_device_id uuid)
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

create function private.kiosk_revoke(p_device_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.kiosk_devices;
begin
  select device.*
  into v_device
  from public.kiosk_devices as device
  where device.id = p_device_id
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.require_kiosk_admin(v_device.organization_id);

  if v_device.status = 'revoked' then
    return;
  end if;

  update public.kiosk_devices as device
  set status = 'revoked', secret_hash = null, paused_until = null
  where device.id = p_device_id;

  delete from private.kiosk_pairing_codes as code
  where code.device_id = p_device_id;

  perform private.write_audit(
    v_device.organization_id,
    'kiosk.revoked',
    'kiosk_device',
    p_device_id,
    pg_catalog.jsonb_build_object('site_id', v_device.site_id)
  );
end;
$$;

-- PINs ------------------------------------------------------------------------------------

create function private.store_pin(p_organization_id uuid, p_employee_id uuid, p_pin text)
returns void
language plpgsql
volatile
set search_path = ''
as $$
begin
  insert into public.employee_pins (employee_id, organization_id, pin_hash, set_by)
  values (p_employee_id, p_organization_id, extensions.crypt(p_pin, extensions.gen_salt('bf', 10)), (select auth.uid()))
  on conflict (employee_id) do update
    set pin_hash = excluded.pin_hash,
        set_by = excluded.set_by,
        set_at = pg_catalog.clock_timestamp();

  -- A new PIN lifts a lockout on every kiosk.
  delete from private.kiosk_attempts as attempt
  where attempt.kind = 'pin_failure'
    and attempt.employee_id = p_employee_id;
end;
$$;

-- Managers: employees (role 'employee' or no login) they can see. Only an
-- owner sets an owner's PIN.
create function private.set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller public.memberships;
  v_employee public.employees;
  v_target_role text;
  v_problem text;
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_caller := private.require_privileged(v_employee.organization_id);

  if not private.can_see_employee(p_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if v_employee.user_id is not null then
    select member.role
    into v_target_role
    from public.memberships as member
    where member.organization_id = v_employee.organization_id
      and member.user_id = v_employee.user_id;
  end if;

  if (v_caller.role = 'manager' and coalesce(v_target_role, 'employee') <> 'employee')
    or (v_target_role = 'owner' and v_caller.role <> 'owner')
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if not v_employee.active then
    raise exception using errcode = '22023', message = 'employee_inactive';
  end if;

  v_problem := private.pin_problem(p_pin);
  if v_problem is not null then
    raise exception using errcode = '22023', message = v_problem;
  end if;

  perform private.store_pin(v_employee.organization_id, p_employee_id, p_pin);

  perform private.write_audit(
    v_employee.organization_id,
    'employee.kiosk_pin_set',
    'employee',
    p_employee_id,
    pg_catalog.jsonb_build_object('by', 'manager')
  );
end;
$$;

-- The caller's own PIN, for each organization they are an active employee of.
-- No MFA: it is their own record. Returns the number of employee rows set.
create function private.set_my_pin(p_pin text)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_problem text;
  v_employee record;
  v_count integer := 0;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_problem := private.pin_problem(p_pin);
  if v_problem is not null then
    raise exception using errcode = '22023', message = v_problem;
  end if;

  for v_employee in
    select employee.id, employee.organization_id
    from public.employees as employee
    join public.memberships as membership
      on membership.organization_id = employee.organization_id
     and membership.user_id = employee.user_id
    where employee.user_id = v_user_id
      and employee.active
      and membership.status = 'active'
    order by employee.organization_id
  loop
    perform private.store_pin(v_employee.organization_id, v_employee.id, p_pin);
    perform private.write_audit(
      v_employee.organization_id,
      'employee.kiosk_pin_set',
      'employee',
      v_employee.id,
      pg_catalog.jsonb_build_object('by', 'self')
    );
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return v_count;
end;
$$;

-- Anonymous: pairing ------------------------------------------------------------------------

create function private.kiosk_pair(p_code text)
returns table (ok boolean, error_code text, device_secret text, device_name text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_now timestamptz;
  v_code text := pg_catalog.upper(pg_catalog.regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_pairing private.kiosk_pairing_codes;
  v_device public.kiosk_devices;
  v_secret bytea;
begin
  -- Pairing is rare: one global lock keeps the pause count exact.
  perform pg_catalog.pg_advisory_xact_lock(1008, 0);
  v_now := pg_catalog.clock_timestamp();

  delete from private.kiosk_attempts as expired
  where expired.created_at < v_now - interval '24 hours';

  if (
    select pg_catalog.count(*)
    from private.kiosk_attempts as attempt
    where attempt.kind = 'pair_failure'
      and attempt.created_at > v_now - interval '15 minutes'
  ) >= 50 then
    return query select false, 'pairing_paused'::text, null::text, null::text;
    return;
  end if;

  if v_code ~ '^[A-HJ-NP-Z2-9]{8}$' then
    select code.*
    into v_pairing
    from private.kiosk_pairing_codes as code
    where code.code_hash = extensions.digest(v_code, 'sha256')
      and code.used_at is null
      and code.expires_at > v_now
    for update;

    if found then
      select device.*
      into v_device
      from public.kiosk_devices as device
      where device.id = v_pairing.device_id
        and device.status = 'active'
      for update;
    end if;
  end if;

  -- Unknown, used and expired codes look the same. No organization is known,
  -- so there is no audit row (like the auth limiter).
  if v_device.id is null then
    insert into private.kiosk_attempts (kind) values ('pair_failure');
    return query select false, 'code_invalid'::text, null::text, null::text;
    return;
  end if;

  update private.kiosk_pairing_codes as code
  set used_at = v_now
  where code.code_hash = v_pairing.code_hash;

  delete from private.kiosk_pairing_codes as other
  where other.device_id = v_device.id
    and other.code_hash <> v_pairing.code_hash;

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

-- Anonymous: the device's work --------------------------------------------------------------

create function private.kiosk_roster(p_device_secret text)
returns table (employee_id uuid, display_name text, initials text, has_pin boolean)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_device public.kiosk_devices;
begin
  v_device := private.kiosk_device_for(p_device_secret);

  if v_device.id is null then
    raise exception using errcode = '42501', message = 'device_unknown';
  end if;

  if v_device.paused_until > pg_catalog.clock_timestamp() then
    raise exception using errcode = 'P0001', message = 'device_paused';
  end if;

  -- At most one write a minute, however often the tablet refreshes.
  update public.kiosk_devices as device
  set last_seen_at = pg_catalog.clock_timestamp()
  where device.id = v_device.id
    and (device.last_seen_at is null or device.last_seen_at < pg_catalog.clock_timestamp() - interval '1 minute');

  return query
  select
    employee.id,
    employee.display_name,
    private.name_initials(employee.display_name),
    exists (select 1 from public.employee_pins as pin where pin.employee_id = employee.id)
  from public.employees as employee
  join public.site_assignments as assignment
    on assignment.organization_id = employee.organization_id
   and assignment.employee_id = employee.id
   and assignment.site_id = v_device.site_id
  join public.sites as site
    on site.organization_id = assignment.organization_id
   and site.id = assignment.site_id
  where employee.organization_id = v_device.organization_id
    and employee.active
    and site.active
    and not exists (
      select 1
      from public.memberships as membership
      where membership.organization_id = employee.organization_id
        and membership.user_id = employee.user_id
        and membership.status = 'suspended'
    )
  order by employee.display_name, employee.id;
end;
$$;

-- Checks the device and the PIN, and records and audits a failure. On success
-- o_error is null. Same bcrypt work on every PIN path, so timing does not tell
-- a wrong PIN from an unknown employee.
create function private.kiosk_verify_pin(
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
  -- under a limit. Re-read after the lock: a concurrent call may have paused
  -- or revoked the device meanwhile.
  perform pg_catalog.pg_advisory_xact_lock(1007, pg_catalog.hashtext(v_device.id::text));
  v_now := pg_catalog.clock_timestamp();

  select device.*
  into v_device
  from public.kiosk_devices as device
  where device.id = v_device.id
    and device.status = 'active';

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

  delete from private.kiosk_attempts as expired
  where expired.created_at < v_now - interval '24 hours';

  select pg_catalog.count(*), pg_catalog.max(attempt.created_at)
  into v_failures, v_last_failure
  from private.kiosk_attempts as attempt
  where attempt.kind = 'pin_failure'
    and attempt.device_id = v_device.id
    and attempt.employee_id = p_employee_id
    and attempt.created_at > v_now - interval '15 minutes';

  -- Only ids of this organization's employees go into its audit trail.
  v_known := exists (
    select 1
    from public.employees as employee
    where employee.id = p_employee_id
      and employee.organization_id = v_device.organization_id
  );
  v_metadata := pg_catalog.jsonb_build_object('device_id', v_device.id)
    || case when v_known then pg_catalog.jsonb_build_object('employee_id', p_employee_id) else '{}'::jsonb end;

  -- Blocked calls are not recorded, so the fifth failure starts the block.
  if v_failures >= 5 then
    o_error := 'pin_locked';
    o_retry_after := greatest(1, ceil(extract(epoch from (v_last_failure + interval '15 minutes' - v_now))))::integer;
    perform private.write_kiosk_audit(
      v_device.organization_id, 'kiosk.pin_refused', 'kiosk_device', v_device.id,
      v_metadata || pg_catalog.jsonb_build_object('reason', 'locked')
    );
    return;
  end if;

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

  perform private.write_kiosk_audit(
    v_device.organization_id, 'kiosk.pin_failed', 'kiosk_device', v_device.id,
    v_metadata || pg_catalog.jsonb_build_object('reason', v_reason)
  );

  select pg_catalog.count(*)
  into v_device_failures
  from private.kiosk_attempts as attempt
  where attempt.kind = 'pin_failure'
    and attempt.device_id = v_device.id
    and attempt.created_at > v_now - interval '15 minutes';

  if v_device_failures >= 30 then
    update public.kiosk_devices as device
    set paused_until = v_now + interval '15 minutes'
    where device.id = v_device.id;

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

-- The employee's current state (off, working, on_break). Never hours.
create function private.kiosk_status(p_device_secret text, p_employee_id uuid, p_pin text)
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
  v_last public.clock_events;
begin
  select verified.*
  into v_check
  from private.kiosk_verify_pin(p_device_secret, p_employee_id, p_pin) as verified;

  if v_check.o_error is not null then
    return query select false, v_check.o_error, v_check.o_tries_left, v_check.o_retry_after,
      null::text, null::timestamptz;
    return;
  end if;

  v_last := private.last_effective_event(v_check.o_organization_id, p_employee_id);
  return query select true, null::text, null::integer, null::integer,
    private.clock_state_after(v_last.type), null::timestamptz;
end;
$$;

create function private.kiosk_clock(
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
    if v_message in ('invalid_transition', 'idempotency_key_reused') then
      return query select false,
        case v_message when 'invalid_transition' then 'invalid_transition' else 'invalid_input' end,
        null::integer, null::integer, null::text, null::timestamptz;
      return;
    end if;
    raise;
  end;

  return query select true, null::text, null::integer, null::integer,
    private.clock_state_after(v_event.type), v_event.occurred_at;
end;
$$;

-- Public wrappers ---------------------------------------------------------------------------

create function public.rpc_kiosk_create(p_site_id uuid, p_name text)
returns table (device_id uuid, pairing_code text, expires_at timestamptz)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.kiosk_create(p_site_id, p_name);
$$;

comment on function public.rpc_kiosk_create(uuid, text) is
  'Owner/admin with fresh MFA: create a kiosk for a site. Returns a one-time pairing code (10 minutes).';

create function public.rpc_kiosk_new_pairing_code(p_device_id uuid)
returns table (pairing_code text, expires_at timestamptz)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.kiosk_new_pairing_code(p_device_id);
$$;

comment on function public.rpc_kiosk_new_pairing_code(uuid) is
  'Owner/admin with fresh MFA: replace the pairing code of an active kiosk.';

create function public.rpc_kiosk_revoke(p_device_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.kiosk_revoke(p_device_id);
$$;

comment on function public.rpc_kiosk_revoke(uuid) is
  'Owner/admin with fresh MFA: revoke a kiosk. Its tablet stops working at once.';

create function public.rpc_set_employee_pin(p_employee_id uuid, p_pin text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.set_employee_pin(p_employee_id, p_pin);
$$;

comment on function public.rpc_set_employee_pin(uuid, text) is
  'Privileged with fresh MFA, manager-scoped: set an employee''s kiosk PIN (4-6 digits, not trivial).';

create function public.rpc_set_my_pin(p_pin text)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select private.set_my_pin(p_pin);
$$;

comment on function public.rpc_set_my_pin(text) is
  'Set the caller''s own kiosk PIN (4-6 digits, not trivial) in every organization they work for.';

create function public.rpc_kiosk_pair(p_code text)
returns table (ok boolean, error_code text, device_secret text, device_name text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.kiosk_pair(p_code);
$$;

comment on function public.rpc_kiosk_pair(text) is
  'Anon: exchange a one-time pairing code for the kiosk device secret (64 hex characters).';

create function public.rpc_kiosk_roster(p_device_secret text)
returns table (employee_id uuid, display_name text, initials text, has_pin boolean)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.kiosk_roster(p_device_secret);
$$;

comment on function public.rpc_kiosk_roster(text) is
  'Anon with a device secret: active employees of the kiosk''s site (name and initials only).';

create function public.rpc_kiosk_status(p_device_secret text, p_employee_id uuid, p_pin text)
returns table (
  ok boolean,
  error_code text,
  tries_left integer,
  retry_after integer,
  state text,
  occurred_at timestamptz
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.kiosk_status(p_device_secret, p_employee_id, p_pin);
$$;

comment on function public.rpc_kiosk_status(text, uuid, text) is
  'Anon with a device secret and the employee''s PIN: current clock state.';

create function public.rpc_kiosk_clock(
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
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.kiosk_clock(p_device_secret, p_employee_id, p_pin, p_type, p_idempotency_key);
$$;

comment on function public.rpc_kiosk_clock(text, uuid, text, text, uuid) is
  'Anon with a device secret and the employee''s PIN: record a live clock event at the kiosk''s site. Idempotent per key.';

-- Grants ------------------------------------------------------------------------------------

revoke all on function private.pin_problem(text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_new_code() from public, anon, authenticated, service_role;
revoke all on function private.kiosk_issue_code(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_device_for(text) from public, anon, authenticated, service_role;
revoke all on function private.name_initials(text) from public, anon, authenticated, service_role;
revoke all on function private.write_kiosk_audit(uuid, text, text, uuid, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.require_kiosk_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function private.append_live_event(uuid, uuid, uuid, text, uuid, timestamptz, text, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.kiosk_create(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_new_pairing_code(uuid) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_revoke(uuid) from public, anon, authenticated, service_role;
revoke all on function private.store_pin(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.set_employee_pin(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.set_my_pin(text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_pair(text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_roster(text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_verify_pin(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_status(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_clock(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.rpc_kiosk_create(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_new_pairing_code(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_revoke(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_set_employee_pin(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_set_my_pin(text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_pair(text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_roster(text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_status(text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_clock(text, uuid, text, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.rpc_kiosk_create(uuid, text) to authenticated;
grant execute on function public.rpc_kiosk_new_pairing_code(uuid) to authenticated;
grant execute on function public.rpc_kiosk_revoke(uuid) to authenticated;
grant execute on function public.rpc_set_employee_pin(uuid, text) to authenticated;
grant execute on function public.rpc_set_my_pin(text) to authenticated;

-- The kiosk calls these without a session. authenticated too, so a signed-in
-- browser on the same tablet behaves the same (the JWT is ignored).
grant execute on function public.rpc_kiosk_pair(text) to anon, authenticated;
grant execute on function public.rpc_kiosk_roster(text) to anon, authenticated;
grant execute on function public.rpc_kiosk_status(text, uuid, text) to anon, authenticated;
grant execute on function public.rpc_kiosk_clock(text, uuid, text, text, uuid) to anon, authenticated;
