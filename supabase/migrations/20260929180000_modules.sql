-- Modules (ADR 008): worker regimes and sectors on top of the core.
--
-- 1. The allowlist (student, flexi, interim, overuren, telework) and the
--    payload rule: a JSON object of at most 8 KiB. The shape per module is
--    checked in the app (@cloxa/modules, zod); the database keeps it bounded.
-- 2. org_modules (per organization: enabled + config) and employee_module_data
--    (per employee and module). Every active member reads their
--    organization's modules (like organizations.settings: the employee app
--    needs to know whether telework is on); module data follows
--    can_see_employee (self, managed sites, whole org).
-- 3. rpc_set_org_module (owner/admin, fresh MFA) and rpc_set_employee_module_data
--    (privileged, visible employee, module enabled). Both audited, with keys
--    only: no free text in audit metadata.
-- 4. clock_events.work_location (telework): 'site' or 'home', only on a
--    clock_in, only when the organization has telework enabled. The canonical
--    bytes gain '|work_location=<value>' only when it is set, after the
--    optional '|offline', so every existing hash stays valid. An adjust
--    correction of a clock_in keeps its location.
-- 5. rpc_clock, rpc_clock_offline and rpc_kiosk_clock take an optional
--    p_work_location. A kiosk stands at a site: it records 'site' for a
--    clock_in when telework is on.
-- 6. Exports: optional 'modules' (header and per row) and 'interim_agency'
--    (an export for one agency); rpc_create_export gains p_interim_agency and
--    checks every row's employee belongs to that agency.
-- 7. Data-subject access carries module data and work locations;
--    anonymisation deletes module data (free text such as an agency reference).

-- 1. Allowlist and payload ---------------------------------------------------------------------

create function private.is_module_id(p_module text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_module in ('student', 'flexi', 'interim', 'overuren', 'telework'), false);
$$;

comment on function private.is_module_id(text) is
  'The modules Cloxa knows (ADR 008). Adding one is a migration plus a package.';

create function private.is_module_payload(p_value jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    pg_catalog.jsonb_typeof(p_value) = 'object' and octet_length(p_value::text) <= 8192,
    false
  );
$$;

comment on function private.is_module_payload(jsonb) is
  'A module config or data value: a JSON object of at most 8 KiB. The shape is checked app-side.';

-- 2. Tables ------------------------------------------------------------------------------------

create table public.org_modules (
  organization_id uuid not null references public.organizations (id) on delete restrict,
  module text not null,
  enabled boolean not null default false,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint org_modules_pkey primary key (organization_id, module),
  constraint org_modules_module_check check (private.is_module_id(module)),
  constraint org_modules_config_check check (private.is_module_payload(config))
);

comment on table public.org_modules is
  'Modules per organization (ADR 008). Written only by rpc_set_org_module.';

create table public.employee_module_data (
  organization_id uuid not null,
  employee_id uuid not null,
  module text not null,
  data jsonb not null default '{}'::jsonb,
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp(),
  constraint employee_module_data_pkey primary key (organization_id, employee_id, module),
  constraint employee_module_data_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint employee_module_data_module_check check (private.is_module_id(module)),
  constraint employee_module_data_data_check check (private.is_module_payload(data))
);

comment on table public.employee_module_data is
  'Per-employee module fields (ADR 008), e.g. the interim agency. Written only by rpc_set_employee_module_data.';

create index employee_module_data_employee_idx on public.employee_module_data (employee_id);

alter table public.org_modules enable row level security;
alter table public.employee_module_data enable row level security;

revoke all on table public.org_modules from public, anon, authenticated, service_role;
revoke all on table public.employee_module_data from public, anon, authenticated, service_role;
grant select on table public.org_modules to authenticated, service_role;
grant select on table public.employee_module_data to authenticated, service_role;

create policy org_modules_select_member
on public.org_modules
for select
to authenticated
using ((private.current_membership(organization_id)).id is not null);

create policy employee_module_data_select_visible
on public.employee_module_data
for select
to authenticated
using (private.can_see_employee(employee_id));

create function private.module_enabled(p_organization_id uuid, p_module text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select org_module.enabled
      from public.org_modules as org_module
      where org_module.organization_id = p_organization_id
        and org_module.module = p_module
    ),
    false
  );
$$;

-- 3. RPCs ----------------------------------------------------------------------------------------

create function private.set_org_module(p_org uuid, p_module text, p_enabled boolean, p_config jsonb)
returns public.org_modules
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller public.memberships;
  v_config jsonb := coalesce(p_config, '{}'::jsonb);
  v_row public.org_modules;
begin
  v_caller := private.require_privileged(p_org);
  if v_caller.role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if not private.is_module_id(p_module) then
    raise exception using errcode = '22023', message = 'invalid_module';
  end if;
  if p_enabled is null then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;
  if not private.is_module_payload(v_config) then
    raise exception using errcode = '22023', message = 'invalid_config';
  end if;

  insert into public.org_modules as org_module (organization_id, module, enabled, config, updated_by)
  values (p_org, p_module, p_enabled, v_config, (select auth.uid()))
  on conflict (organization_id, module) do update
  set enabled = excluded.enabled,
      config = excluded.config,
      updated_by = excluded.updated_by,
      updated_at = pg_catalog.clock_timestamp()
  returning * into v_row;

  -- Keys only: config values are the owner's words, not facts for the log.
  perform private.write_audit(
    p_org,
    'organization.module_updated',
    'organization',
    p_org,
    pg_catalog.jsonb_build_object(
      'module', p_module,
      'enabled', p_enabled,
      'config_keys', coalesce(
        (select pg_catalog.jsonb_agg(config_key.name order by config_key.name)
         from pg_catalog.jsonb_object_keys(v_config) as config_key (name)),
        '[]'::jsonb
      )
    )
  );

  return v_row;
end;
$$;

create function public.rpc_set_org_module(p_org uuid, p_module text, p_enabled boolean, p_config jsonb default '{}'::jsonb)
returns public.org_modules
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.set_org_module(p_org, p_module, p_enabled, p_config);
$$;

comment on function public.rpc_set_org_module(uuid, text, boolean, jsonb) is
  'Owner/admin (fresh MFA): switch a module on or off and set its config (a JSON object, at most 8 KiB). Audited.';

create function private.set_employee_module_data(p_employee_id uuid, p_module text, p_data jsonb)
returns public.employee_module_data
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_row public.employee_module_data;
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.require_privileged(v_employee.organization_id);
  if not private.can_see_employee(v_employee.id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if not private.is_module_id(p_module) then
    raise exception using errcode = '22023', message = 'invalid_module';
  end if;
  if not private.module_enabled(v_employee.organization_id, p_module) then
    raise exception using errcode = '22023', message = 'module_disabled';
  end if;
  if v_employee.anonymised_at is not null then
    raise exception using errcode = '22023', message = 'employee_anonymised';
  end if;
  if not private.is_module_payload(p_data) then
    raise exception using errcode = '22023', message = 'invalid_data';
  end if;

  insert into public.employee_module_data as module_data (organization_id, employee_id, module, data, updated_by)
  values (v_employee.organization_id, v_employee.id, p_module, p_data, (select auth.uid()))
  on conflict (organization_id, employee_id, module) do update
  set data = excluded.data,
      updated_by = excluded.updated_by,
      updated_at = pg_catalog.clock_timestamp()
  returning * into v_row;

  perform private.write_audit(
    v_employee.organization_id,
    'employee.module_data_updated',
    'employee',
    v_employee.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee.id,
      'module', p_module,
      'field_keys', coalesce(
        (select pg_catalog.jsonb_agg(data_key.name order by data_key.name)
         from pg_catalog.jsonb_object_keys(p_data) as data_key (name)),
        '[]'::jsonb
      )
    )
  );

  return v_row;
end;
$$;

create function public.rpc_set_employee_module_data(p_employee_id uuid, p_module text, p_data jsonb)
returns public.employee_module_data
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.set_employee_module_data(p_employee_id, p_module, p_data);
$$;

comment on function public.rpc_set_employee_module_data(uuid, text, jsonb) is
  'Privileged (fresh MFA), visible employee, module enabled: set the employee''s fields for one module (a JSON object, at most 8 KiB). Audited.';

-- 4. Work location on clock events ------------------------------------------------------------

alter table public.clock_events add column work_location text;

alter table public.clock_events
  add constraint clock_events_work_location_check
    check (work_location is null or (type = 'clock_in' and work_location in ('site', 'home')));

comment on column public.clock_events.work_location is
  'Telework module (ADR 008): where this shift is worked, site or home. Only on clock_in; null when not asked.';

-- The same 14 fields and optional '|offline' as before; '|work_location=...'
-- is appended only when set, so the bytes (and hashes) of every earlier row
-- are unchanged. Unambiguous: geo is '' or a jsonb object, and the two
-- suffixes are distinct literals in a fixed order.
create or replace function private.clock_event_canonical(p_row public.clock_events)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.concat_ws(
    '|',
    p_row.id::text,
    p_row.organization_id::text,
    p_row.site_id::text,
    p_row.employee_id::text,
    p_row.type,
    private.epoch_us(p_row.occurred_at),
    private.epoch_us(p_row.server_at),
    coalesce(private.epoch_us(p_row.client_captured_at), ''),
    p_row.source,
    coalesce(p_row.supersedes_event_id::text, ''),
    coalesce(p_row.correction_id::text, ''),
    coalesce(p_row.actor_user_id::text, ''),
    coalesce(p_row.device_id::text, ''),
    coalesce(p_row.geo::text, '')
  )
  || case when p_row.offline then '|offline' else '' end
  || case when p_row.work_location is not null then '|work_location=' || p_row.work_location else '' end;
$$;

create or replace function private.clock_events_append()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.prev_hash := private.chain_lock_head(new.organization_id, 'clock_events');
  -- Stamped after the chain lock so server_at order matches chain order.
  new.server_at := pg_catalog.clock_timestamp();
  if new.offline then
    -- An offline event keeps its captured time, but only within 72 hours
    -- before the sync. Out of range is refused, never silently moved.
    if new.source <> 'app'
      or new.occurred_at is null
      or new.occurred_at > new.server_at
      or new.occurred_at < new.server_at - interval '72 hours'
    then
      raise exception using errcode = '22023', message = 'offline_time_out_of_range';
    end if;
  elsif new.source <> 'correction' then
    new.occurred_at := new.server_at;
  end if;
  -- Moving a clock-in (an adjust correction) keeps where the shift was worked.
  if new.source = 'correction'
    and new.type = 'clock_in'
    and new.supersedes_event_id is not null
    and new.work_location is null
  then
    select replaced.work_location
    into new.work_location
    from public.clock_events as replaced
    where replaced.id = new.supersedes_event_id
      and replaced.organization_id = new.organization_id
      and replaced.type = 'clock_in';
  end if;
  new.hash := private.chain_hash(new.prev_hash, private.clock_event_canonical(new));
  perform private.chain_set_head(new.organization_id, 'clock_events', new.id, new.hash);
  return new;
end;
$$;

-- 5. Clocking with a work location --------------------------------------------------------------

drop function public.rpc_clock(text, uuid, uuid, timestamptz);
drop function private.clock(text, uuid, uuid, timestamptz);
drop function public.rpc_kiosk_clock(text, uuid, text, text, uuid);
drop function private.kiosk_clock(text, uuid, text, text, uuid);
drop function private.append_live_event(uuid, uuid, uuid, text, uuid, timestamptz, text, uuid, uuid);
drop function public.rpc_clock_offline(text, uuid, uuid, timestamptz);
drop function private.clock_offline(text, uuid, uuid, timestamptz);

-- Null, or 'site'/'home' on a clock_in. Raises for anything else.
create function private.check_work_location(p_type text, p_work_location text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_work_location is not null
    and (p_work_location not in ('site', 'home') or p_type is distinct from 'clock_in')
  then
    raise exception using errcode = '22023', message = 'invalid_work_location';
  end if;
end;
$$;

-- The live append shared by rpc_clock (source 'app') and the kiosk: per-employee
-- lock, idempotent replay, site assignment, telework, transition rules, insert,
-- audit. Callers have already decided who the employee is.
create function private.append_live_event(
  p_organization_id uuid,
  p_employee_id uuid,
  p_site_id uuid,
  p_type text,
  p_idempotency_key uuid,
  p_client_captured_at timestamptz,
  p_source text,
  p_actor_user_id uuid,
  p_device_id uuid,
  p_work_location text
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
  perform private.check_work_location(p_type, p_work_location);

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

  -- After the replay: an answer once given never changes with the setting.
  if p_work_location is not null and not private.module_enabled(p_organization_id, 'telework') then
    raise exception using errcode = '22023', message = 'telework_disabled';
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
    idempotency_key,
    work_location
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
    p_idempotency_key,
    p_work_location
  )
  returning * into v_event;

  v_metadata := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'employee_id', p_employee_id,
    'site_id', p_site_id,
    'type', p_type,
    'source', p_source,
    'work_location', p_work_location
  ));

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

create function private.clock(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz default null,
  p_work_location text default null
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

  perform private.check_work_location(p_type, p_work_location);

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
    null,
    p_work_location
  );
end;
$$;

create function public.rpc_clock(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz default null,
  p_work_location text default null
)
returns public.clock_events
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.clock(p_type, p_idempotency_key, p_site_id, p_client_captured_at, p_work_location);
$$;

comment on function public.rpc_clock(text, uuid, uuid, timestamptz, text) is
  'Record a live clock_in/clock_out/break_start/break_end for the caller at an assigned site. Idempotent per key. p_work_location (site/home) only on a clock_in with telework enabled.';

create function private.kiosk_clock(
  p_device_secret text,
  p_employee_id uuid,
  p_pin text,
  p_type text,
  p_idempotency_key uuid,
  p_work_location text default null
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
  v_location text := p_work_location;
begin
  -- A kiosk stands at a site: 'home' can never be true there.
  if p_type is null
    or p_type not in ('clock_in', 'clock_out', 'break_start', 'break_end')
    or p_idempotency_key is null
    or (p_work_location is not null and (p_work_location <> 'site' or p_type <> 'clock_in'))
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

  -- With telework on, a clock-in at the kiosk is a shift at the site; with it
  -- off, no location is recorded at all.
  if private.module_enabled(v_check.o_organization_id, 'telework') then
    if p_type = 'clock_in' then
      v_location := 'site';
    end if;
  else
    v_location := null;
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
      v_check.o_device_id,
      v_location
    );
  exception when others then
    get stacked diagnostics v_message = message_text;
    if v_message in ('invalid_transition', 'idempotency_key_reused', 'site_not_assigned', 'telework_disabled') then
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

create function public.rpc_kiosk_clock(
  p_device_secret text,
  p_employee_id uuid,
  p_pin text,
  p_type text,
  p_idempotency_key uuid,
  p_work_location text default null
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
  select * from private.kiosk_clock(p_device_secret, p_employee_id, p_pin, p_type, p_idempotency_key, p_work_location);
$$;

comment on function public.rpc_kiosk_clock(text, uuid, text, text, uuid, text) is
  'Anon with a device secret and the employee''s PIN: record a live clock event at the kiosk''s site. Idempotent per key. With telework on, a clock_in is recorded at the site.';

-- Same outcomes, locks and replays as before (offline_hardening); only the
-- work location is new. It is dropped when the event becomes a correction
-- request: a manager confirms the time, not the place.
create function private.clock_offline(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz,
  p_work_location text default null
)
returns table (o_outcome text, o_event_id uuid, o_correction_id uuid, o_reason text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_captured timestamptz := p_client_captured_at;
  v_organization_id uuid;
  v_employee_id uuid;
  v_now timestamptz;
  v_site_active boolean;
  v_assigned boolean;
  v_existing public.clock_events;
  v_request public.correction_requests;
  v_last public.clock_events;
  v_cause text;
  v_event public.clock_events;
  v_events jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_type is null or p_type not in ('clock_in', 'clock_out', 'break_start', 'break_end') then
    raise exception using errcode = '22023', message = 'invalid_clock_type';
  end if;

  if p_idempotency_key is null
    or p_site_id is null
    or v_captured is null
    or v_captured in ('infinity', '-infinity')
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  perform private.check_work_location(p_type, p_work_location);

  -- Same identity rules as rpc_clock: the site decides the organization and
  -- the employee row is always the caller's own.
  select site.organization_id, site.active
  into v_organization_id, v_site_active
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

  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_employee_id::text));
  v_now := pg_catalog.clock_timestamp();

  -- Replays first (under the employee lock), so a switched-off setting or a
  -- later event never changes an answer already given. The key may also be
  -- a live rpc_clock whose response was lost before the client queued it.
  select event.*
  into v_existing
  from public.clock_events as event
  where event.organization_id = v_organization_id
    and event.employee_id = v_employee_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.type <> p_type or v_existing.site_id <> p_site_id then
      raise exception using errcode = '22023', message = 'idempotency_key_reused';
    end if;
    return query select 'recorded'::text, v_existing.id, null::uuid, null::text;
    return;
  end if;

  select request.*
  into v_request
  from public.correction_requests as request
  where request.organization_id = v_organization_id
    and request.employee_id = v_employee_id
    and request.idempotency_key = p_idempotency_key;

  if found then
    if (v_request.proposed #>> '{events,0,type}') is distinct from p_type
      or (v_request.proposed #>> '{events,0,site_id}') is distinct from p_site_id::text
    then
      raise exception using errcode = '22023', message = 'idempotency_key_reused';
    end if;
    return query select 'correction_requested'::text, null::uuid, v_request.id, v_request.offline_reason;
    return;
  end if;

  if p_work_location is not null and not private.module_enabled(v_organization_id, 'telework') then
    raise exception using errcode = '22023', message = 'telework_disabled';
  end if;

  if not private.offline_clocking_enabled(v_organization_id) then
    return query select 'rejected'::text, null::uuid, null::uuid, 'offline_disabled'::text;
    return;
  end if;

  -- Not plausible as a fact: a device clock ahead of the server, or older
  -- than any correction may reach.
  if v_captured > v_now then
    return query select 'rejected'::text, null::uuid, null::uuid, 'captured_in_future'::text;
    return;
  end if;

  if v_captured < v_now - pg_catalog.make_interval(days => private.correction_max_age_days(v_organization_id)) then
    return query select 'rejected'::text, null::uuid, null::uuid, 'captured_too_old'::text;
    return;
  end if;

  -- A correction at an inactive site could never be approved.
  if not v_site_active then
    return query select 'rejected'::text, null::uuid, null::uuid, 'site_inactive'::text;
    return;
  end if;

  v_assigned := exists (
    select 1
    from public.site_assignments as assignment
    where assignment.organization_id = v_organization_id
      and assignment.site_id = p_site_id
      and assignment.employee_id = v_employee_id
  );

  v_last := private.last_effective_event(v_organization_id, v_employee_id);

  -- The trigger allows 72 hours before its own server_at, stamped after the
  -- chain lock (1002); five minutes of margin covers that wait. Within that
  -- hard cap, a delay beyond the org's offline_max_skew_minutes is for a
  -- manager to confirm: a phone clock set back is the obvious way to backdate.
  v_cause := case
    when v_captured < v_now - interval '72 hours' + interval '5 minutes' then 'outside_window'
    when v_captured < v_now - pg_catalog.make_interval(mins => private.offline_max_skew_minutes(v_organization_id))
      then 'offline_skew'
    when not v_assigned then 'site_not_assigned'
    when v_last.id is not null and v_last.occurred_at >= v_captured then 'later_event_exists'
    when private.clock_next_state(private.clock_state_after(v_last.type), p_type) is null then 'invalid_transition'
  end;

  if v_cause is null then
    insert into public.clock_events (
      organization_id,
      site_id,
      employee_id,
      type,
      occurred_at,
      server_at,
      client_captured_at,
      source,
      actor_user_id,
      idempotency_key,
      offline,
      work_location
    )
    values (
      v_organization_id,
      p_site_id,
      v_employee_id,
      p_type,
      v_captured,
      v_now,
      v_captured,
      'app',
      v_user_id,
      p_idempotency_key,
      true,
      p_work_location
    )
    returning * into v_event;

    perform private.write_audit(
      v_organization_id,
      'clock_event.recorded',
      'clock_event',
      v_event.id,
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'employee_id', v_employee_id,
        'site_id', p_site_id,
        'type', p_type,
        'source', 'app',
        'offline', true,
        'skew_seconds', pg_catalog.floor(extract(epoch from (v_event.server_at - v_event.occurred_at)))::bigint,
        'work_location', p_work_location
      ))
    );

    return query select 'recorded'::text, v_event.id, null::uuid, null::text;
    return;
  end if;

  -- Does not fit: the manager decides. Same stored shape as
  -- rpc_request_correction; approval re-validates everything.
  v_events := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'type', p_type,
    'occurred_at', v_captured,
    'site_id', p_site_id
  ));

  if private.proposed_times_problem(v_organization_id, v_employee_id, v_events) is not null then
    return query select 'rejected'::text, null::uuid, null::uuid, 'time_conflict'::text;
    return;
  end if;

  if (
    select pg_catalog.count(*)
    from public.correction_requests as pending
    where pending.organization_id = v_organization_id
      and pending.employee_id = v_employee_id
      and pending.status = 'pending'
  ) >= 20 then
    return query select 'rejected'::text, null::uuid, null::uuid, 'too_many_pending'::text;
    return;
  end if;

  insert into public.correction_requests (
    organization_id,
    employee_id,
    requested_by,
    kind,
    target_event_ids,
    proposed,
    reason,
    offline,
    idempotency_key,
    offline_reason
  )
  values (
    v_organization_id,
    v_employee_id,
    v_user_id,
    'add',
    '{}',
    pg_catalog.jsonb_build_object('events', v_events),
    'Offline geregistreerd',
    true,
    p_idempotency_key,
    v_cause
  )
  returning * into v_request;

  perform private.write_audit(
    v_organization_id,
    'correction_request.created',
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee_id,
      'kind', 'add',
      'target_count', 0,
      'event_count', 1,
      'offline', true,
      'offline_reason', v_cause
    )
  );

  return query select 'correction_requested'::text, null::uuid, v_request.id, v_cause;
end;
$$;

create function public.rpc_clock_offline(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz,
  p_work_location text default null
)
returns table (outcome text, event_id uuid, correction_id uuid, reason text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.clock_offline(p_type, p_idempotency_key, p_site_id, p_client_captured_at, p_work_location);
$$;

comment on function public.rpc_clock_offline(text, uuid, uuid, timestamptz, text) is
  'Sync one queued offline clock action of the caller: recorded, correction_requested or rejected. Idempotent per key. p_work_location as in rpc_clock.';

-- 6. Exports -------------------------------------------------------------------------------------

alter table public.exports add column interim_agency text;

alter table public.exports
  add constraint exports_interim_agency_check
    check (interim_agency is null or (btrim(interim_agency) = interim_agency and char_length(interim_agency) between 1 and 200));

comment on column public.exports.interim_agency is
  'Set when the export holds only the workers of one interim agency (ADR 008).';

grant select (interim_agency) on table public.exports to authenticated;

drop function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text);
drop function private.create_export(uuid, date, date, uuid[], integer, text, bytea, text);

-- A row's "modules" value: an object of known modules, each an object of
-- plain values (the export columns of that module for that employee-day).
create function private.is_export_modules_value(p_value jsonb, p_allowed jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when pg_catalog.jsonb_typeof(p_value) is distinct from 'object' then false
    else not exists (
      select 1
      from pg_catalog.jsonb_each(p_value) as module_entry (name, value)
      where case
        when not (p_allowed ? module_entry.name) then true
        when pg_catalog.jsonb_typeof(module_entry.value) <> 'object' then true
        else exists (
          select 1
          from pg_catalog.jsonb_each(module_entry.value) as column_entry (name, value)
          where pg_catalog.jsonb_typeof(column_entry.value) not in ('string', 'number', 'boolean', 'null')
        )
      end
    )
  end;
$$;

create function private.create_export(
  p_org uuid,
  p_period_from date,
  p_period_to date,
  p_site_ids uuid[],
  p_row_count integer,
  p_content text,
  p_signature bytea,
  p_signing_key_id text,
  p_interim_agency text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_top_keys constant text[] := array[
    'format_version', 'organization_id', 'created_by', 'generated_at', 'period', 'site_ids', 'rows',
    'modules', 'interim_agency'
  ];
  v_period_keys constant text[] := array['from', 'to', 'timezone'];
  v_row_keys constant text[] := array[
    'day', 'employee_id', 'employee_code', 'employee_name', 'shifts',
    'planned_ms', 'worked_net_ms', 'deviation_ms', 'edited', 'modules'
  ];
  v_shift_keys constant text[] := array[
    'site_id', 'site_name', 'start_utc', 'end_utc', 'start_local', 'end_local',
    'break_ms', 'gross_ms', 'net_ms', 'edited', 'open', 'overnight'
  ];
  v_content jsonb;
  v_modules jsonb;
  v_from text;
  v_to text;
  v_id uuid;
begin
  perform private.require_privileged(p_org);

  if p_period_from is null
    or p_period_to is null
    or p_period_to < p_period_from
    or p_period_to - p_period_from > 61
  then
    raise exception using errcode = '22023', message = 'invalid_period';
  end if;

  -- Sorted, distinct and without nulls, so the stored scope and the signed
  -- content agree on one spelling.
  if p_site_ids is not null and (
    pg_catalog.array_position(p_site_ids, null) is not null
    or p_site_ids is distinct from (
      select pg_catalog.array_agg(distinct requested.site_id order by requested.site_id)
      from pg_catalog.unnest(p_site_ids) as requested (site_id)
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_sites';
  end if;

  if p_interim_agency is not null
    and (btrim(p_interim_agency) <> p_interim_agency or char_length(p_interim_agency) not between 1 and 200)
  then
    raise exception using errcode = '22023', message = 'invalid_interim_agency';
  end if;

  if not private.export_scope_ok(p_org, p_site_ids) then
    raise exception using errcode = '42501', message = 'site_not_visible';
  end if;

  -- Serialize creations per organization (the audit chain lock, taken again
  -- by write_audit below), so two parallel requests cannot both pass the count.
  perform pg_catalog.pg_advisory_xact_lock(1001, pg_catalog.hashtext(p_org::text));

  if (
      select pg_catalog.count(*)
      from public.audit_log as log
      where log.action = 'export.created'
        and log.actor_user_id = (select auth.uid())
        and log.created_at > pg_catalog.now() - interval '1 hour'
    ) >= 20
    or (
      select pg_catalog.count(*)
      from public.audit_log as log
      where log.organization_id = p_org
        and log.action = 'export.created'
        and log.created_at > pg_catalog.now() - interval '1 day'
    ) >= 100
  then
    raise exception using errcode = '54000', message = 'export_rate_limited';
  end if;

  -- Measured before parsing, so an oversized payload costs no JSON work.
  if p_content is null or octet_length(p_content) > 10485760 then
    raise exception using errcode = '22023', message = 'content_too_large';
  end if;

  if p_signature is null or octet_length(p_signature) <> 64 then
    raise exception using errcode = '22023', message = 'invalid_signature';
  end if;

  if p_signing_key_id is null or p_signing_key_id !~ '^[A-Za-z0-9._-]{1,64}$' then
    raise exception using errcode = '22023', message = 'invalid_signing_key_id';
  end if;

  begin
    v_content := p_content::jsonb;
  exception
    when others then
      raise exception using errcode = '22023', message = 'invalid_content';
  end;

  v_from := pg_catalog.to_char(p_period_from, 'YYYY-MM-DD');
  v_to := pg_catalog.to_char(p_period_to, 'YYYY-MM-DD');

  -- The header must describe exactly this request, for this caller, and
  -- carry nothing else.
  if (case
    when pg_catalog.jsonb_typeof(v_content) is distinct from 'object' then true
    when not private.jsonb_keys_within(v_content, v_top_keys) then true
    when pg_catalog.jsonb_typeof(v_content -> 'period') is distinct from 'object' then true
    when not private.jsonb_keys_within(v_content -> 'period', v_period_keys) then true
    else (v_content ->> 'format_version') is distinct from 'cloxa.export.v1'
      or (v_content ->> 'organization_id') is distinct from p_org::text
      or (v_content ->> 'created_by') is distinct from (select auth.uid())::text
      or (v_content #>> '{period,from}') is distinct from v_from
      or (v_content #>> '{period,to}') is distinct from v_to
      or (v_content -> 'site_ids') is distinct from coalesce(pg_catalog.to_jsonb(p_site_ids), 'null'::jsonb)
      or pg_catalog.jsonb_typeof(v_content -> 'rows') is distinct from 'array'
      or (v_content -> 'interim_agency') is distinct from pg_catalog.to_jsonb(p_interim_agency)
  end) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  -- Modules: absent, or a sorted list of distinct known modules. An agency
  -- export needs the interim module.
  v_modules := v_content -> 'modules';
  if (case
    when v_modules is null then p_interim_agency is not null
    when pg_catalog.jsonb_typeof(v_modules) <> 'array' then true
    when pg_catalog.jsonb_array_length(v_modules) = 0 then true
    when exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_modules) as module_entry (value)
      where pg_catalog.jsonb_typeof(module_entry.value) <> 'string'
        or not private.is_module_id(module_entry.value #>> '{}')
    ) then true
    else v_modules is distinct from (
        select pg_catalog.jsonb_agg(distinct module_entry.value order by module_entry.value)
        from pg_catalog.jsonb_array_elements(v_modules) as module_entry (value)
      )
      or (p_interim_agency is not null and not v_modules @> '["interim"]'::jsonb)
  end) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  if p_row_count is null or pg_catalog.jsonb_array_length(v_content -> 'rows') <> p_row_count then
    raise exception using errcode = '22023', message = 'row_count_mismatch';
  end if;

  -- Row and shift shape. CASE fixes the evaluation order, so the checks after
  -- a failed one never see a malformed value.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where case
      when pg_catalog.jsonb_typeof(row_entry.value) <> 'object' then true
      when not private.jsonb_keys_within(row_entry.value, v_row_keys) then true
      when pg_catalog.jsonb_typeof(row_entry.value -> 'employee_id') is distinct from 'string' then true
      when (row_entry.value ->> 'employee_id') !~ v_uuid then true
      when pg_catalog.jsonb_typeof(row_entry.value -> 'day') is distinct from 'string' then true
      when (row_entry.value ->> 'day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then true
      when (row_entry.value ->> 'day') < v_from or (row_entry.value ->> 'day') > v_to then true
      when pg_catalog.jsonb_typeof(row_entry.value -> 'shifts') is distinct from 'array' then true
      -- Rows carry "modules" exactly when the header lists them.
      when (row_entry.value ? 'modules') is distinct from (v_modules is not null) then true
      when v_modules is not null
        and not private.is_export_modules_value(row_entry.value -> 'modules', v_modules)
        then true
      else exists (
        select 1
        from pg_catalog.jsonb_array_elements(row_entry.value -> 'shifts') as shift_entry (value)
        where case
          when pg_catalog.jsonb_typeof(shift_entry.value) <> 'object' then true
          when not private.jsonb_keys_within(shift_entry.value, v_shift_keys) then true
          when pg_catalog.jsonb_typeof(shift_entry.value -> 'site_id') is distinct from 'string' then true
          else (shift_entry.value ->> 'site_id') !~ v_uuid
        end
      )
    end
  ) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  -- One row per employee per day.
  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct (row_entry.value ->> 'employee_id', row_entry.value ->> 'day'))
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
  ) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  -- Every row is a visible employee of this organization, and every shift is
  -- at a site inside the export scope. Shapes were checked above, so the
  -- casts are safe.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where not exists (
        select 1
        from public.employees as employee
        where employee.id = (row_entry.value ->> 'employee_id')::uuid
          and employee.organization_id = p_org
      )
      or not private.can_see_employee((row_entry.value ->> 'employee_id')::uuid)
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(row_entry.value -> 'shifts') as shift_entry (value)
        where case
          when p_site_ids is null then not exists (
            select 1
            from public.sites as site
            where site.organization_id = p_org
              and site.id = (shift_entry.value ->> 'site_id')::uuid
          )
          else not ((shift_entry.value ->> 'site_id')::uuid = any (p_site_ids))
        end
      )
  ) then
    raise exception using errcode = '42501', message = 'row_not_visible';
  end if;

  -- An agency export holds only that agency's workers.
  if p_interim_agency is not null and exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where not exists (
      select 1
      from public.employee_module_data as module_data
      where module_data.organization_id = p_org
        and module_data.employee_id = (row_entry.value ->> 'employee_id')::uuid
        and module_data.module = 'interim'
        and (module_data.data ->> 'agency_name') = p_interim_agency
    )
  ) then
    raise exception using errcode = '42501', message = 'row_not_visible';
  end if;

  insert into public.exports (
    organization_id,
    site_ids,
    period_from,
    period_to,
    format_version,
    created_by,
    row_count,
    content_sha256,
    signature,
    signing_key_id,
    content,
    interim_agency
  )
  values (
    p_org,
    p_site_ids,
    p_period_from,
    p_period_to,
    'cloxa.export.v1',
    (select auth.uid()),
    p_row_count,
    extensions.digest(pg_catalog.convert_to(p_content, 'UTF8'), 'sha256'),
    p_signature,
    p_signing_key_id,
    pg_catalog.convert_to(p_content, 'UTF8'),
    p_interim_agency
  )
  returning id into v_id;

  perform private.write_audit(
    p_org,
    'export.created',
    'export',
    v_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'period_from', p_period_from,
      'period_to', p_period_to,
      'site_count', pg_catalog.cardinality(p_site_ids),
      'row_count', p_row_count,
      'signing_key_id', p_signing_key_id,
      'modules', v_modules,
      'agency_filter', case when p_interim_agency is not null then true end
    ))
  );

  return v_id;
end;
$$;

create function public.rpc_create_export(
  p_org uuid,
  p_period_from date,
  p_period_to date,
  p_site_ids uuid[],
  p_row_count integer,
  p_content text,
  p_signature bytea,
  p_signing_key_id text,
  p_interim_agency text default null
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.create_export(
    p_org, p_period_from, p_period_to, p_site_ids, p_row_count, p_content, p_signature, p_signing_key_id,
    p_interim_agency
  );
$$;

comment on function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text, text) is
  'Privileged (fresh MFA), in scope: store a signed cloxa.export.v1 snapshot. p_interim_agency: only that agency''s workers.';

-- 7. Data-subject access and anonymisation ------------------------------------------------------

create or replace function private.subject_document(p_employee_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_membership_ids uuid[];
  v_correction_ids uuid[];
  v_invitation_ids uuid[];
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  select coalesce(pg_catalog.array_agg(member.id), '{}')
  into v_membership_ids
  from public.memberships as member
  where member.organization_id = v_employee.organization_id
    and member.user_id = v_employee.user_id;

  select coalesce(pg_catalog.array_agg(request.id), '{}')
  into v_correction_ids
  from public.correction_requests as request
  where request.organization_id = v_employee.organization_id
    and request.employee_id = v_employee.id;

  select coalesce(pg_catalog.array_agg(invitation.id), '{}')
  into v_invitation_ids
  from public.invitations as invitation
  where invitation.organization_id = v_employee.organization_id
    and invitation.employee_id = v_employee.id;

  return pg_catalog.jsonb_build_object(
    'format', 'cloxa.subject_export.v1',
    'generated_at', pg_catalog.clock_timestamp(),
    'organization', (
      select pg_catalog.jsonb_build_object('id', organization.id, 'name', organization.name)
      from public.organizations as organization
      where organization.id = v_employee.organization_id
    ),
    'employee', pg_catalog.jsonb_build_object(
      'id', v_employee.id,
      'user_id', v_employee.user_id,
      'display_name', v_employee.display_name,
      'employee_code', v_employee.employee_code,
      'statute', v_employee.statute,
      'language', v_employee.language,
      'active', v_employee.active,
      'left_at', v_employee.left_at,
      'anonymised_at', v_employee.anonymised_at,
      'created_at', v_employee.created_at,
      'updated_at', v_employee.updated_at
    ),
    'memberships', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', member.id, 'role', member.role, 'status', member.status,
        'created_at', member.created_at, 'updated_at', member.updated_at
      ) order by member.created_at)
      from public.memberships as member
      where member.id = any (v_membership_ids)
    ), '[]'::jsonb),
    'site_assignments', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'site_id', assignment.site_id,
        'site_name', site.name,
        'as', case when assignment.employee_id is not null then 'employee' else 'manager' end,
        'created_at', assignment.created_at
      ) order by assignment.created_at)
      from public.site_assignments as assignment
      join public.sites as site
        on site.organization_id = assignment.organization_id
       and site.id = assignment.site_id
      where assignment.organization_id = v_employee.organization_id
        and (assignment.employee_id = v_employee.id or assignment.membership_id = any (v_membership_ids))
    ), '[]'::jsonb),
    'schedules', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', schedule.id, 'version', schedule.version, 'valid_from', schedule.valid_from,
        'pattern', schedule.pattern, 'notified_at', schedule.notified_at,
        'created_by', schedule.created_by, 'created_at', schedule.created_at
      ) order by schedule.version)
      from public.schedules as schedule
      where schedule.organization_id = v_employee.organization_id
        and schedule.employee_id = v_employee.id
    ), '[]'::jsonb),
    'clock_events', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', event.id, 'site_id', event.site_id, 'type', event.type,
        'occurred_at', event.occurred_at, 'server_at', event.server_at,
        'client_captured_at', event.client_captured_at, 'source', event.source,
        'offline', event.offline, 'device_id', event.device_id, 'geo', event.geo,
        'work_location', event.work_location,
        'supersedes_event_id', event.supersedes_event_id, 'correction_id', event.correction_id,
        'actor_user_id', event.actor_user_id,
        'effective', not exists (
          select 1
          from public.clock_events as later
          where later.supersedes_event_id = event.id
        )
      ) order by event.occurred_at, event.server_at)
      from public.clock_events as event
      where event.organization_id = v_employee.organization_id
        and event.employee_id = v_employee.id
    ), '[]'::jsonb),
    'correction_requests', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', request.id, 'kind', request.kind, 'status', request.status,
        'target_event_ids', pg_catalog.to_jsonb(request.target_event_ids),
        'proposed', request.proposed, 'reason', request.reason,
        'requested_by', request.requested_by, 'created_at', request.created_at,
        'decided_by', request.decided_by, 'decided_at', request.decided_at,
        'decision_note', request.decision_note, 'offline', request.offline,
        'offline_reason', request.offline_reason
      ) order by request.created_at)
      from public.correction_requests as request
      where request.id = any (v_correction_ids)
    ), '[]'::jsonb),
    'invitations', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', invitation.id, 'email', invitation.email, 'role', invitation.role,
        'status', invitation.status, 'invited_by', invitation.invited_by,
        'created_at', invitation.created_at, 'expires_at', invitation.expires_at
      ) order by invitation.created_at)
      from public.invitations as invitation
      where invitation.id = any (v_invitation_ids)
    ), '[]'::jsonb),
    'pin', (
      select pg_catalog.jsonb_build_object('set_at', pin.set_at, 'set_by', pin.set_by)
      from public.employee_pins as pin
      where pin.organization_id = v_employee.organization_id
        and pin.employee_id = v_employee.id
    ),
    'module_data', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'module', module_data.module, 'data', module_data.data,
        'updated_by', module_data.updated_by, 'updated_at', module_data.updated_at
      ) order by module_data.module)
      from public.employee_module_data as module_data
      where module_data.organization_id = v_employee.organization_id
        and module_data.employee_id = v_employee.id
    ), '[]'::jsonb),
    'audit_log', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', log.id, 'created_at', log.created_at, 'actor_user_id', log.actor_user_id,
        'action', log.action, 'entity', log.entity, 'entity_id', log.entity_id,
        'metadata', log.metadata
      ) order by log.created_at)
      from public.audit_log as log
      where log.organization_id = v_employee.organization_id
        and (
          (v_employee.user_id is not null and log.actor_user_id = v_employee.user_id)
          or log.entity_id = v_employee.id
          or log.entity_id = any (v_membership_ids)
          or log.entity_id = any (v_correction_ids)
          or log.entity_id = any (v_invitation_ids)
          or log.metadata ->> 'employee_id' = v_employee.id::text
        )
    ), '[]'::jsonb)
  );
end;
$$;

-- Module data holds free text (an agency reference): it goes with the name.
create function private.employee_module_data_anonymise()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.employee_module_data as module_data
  where module_data.organization_id = new.organization_id
    and module_data.employee_id = new.id;
  return new;
end;
$$;

create trigger employees_anonymise_module_data
after update of anonymised_at on public.employees
for each row
when (old.anonymised_at is null and new.anonymised_at is not null)
execute function private.employee_module_data_anonymise();

-- Access ---------------------------------------------------------------------------------------

revoke all on function private.is_module_id(text) from public, anon, authenticated, service_role;
revoke all on function private.is_module_payload(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.module_enabled(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.set_org_module(uuid, text, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.set_employee_module_data(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.check_work_location(text, text) from public, anon, authenticated, service_role;
revoke all on function private.append_live_event(uuid, uuid, uuid, text, uuid, timestamptz, text, uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.clock(text, uuid, uuid, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function private.kiosk_clock(text, uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.clock_offline(text, uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function private.is_export_modules_value(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.create_export(uuid, date, date, uuid[], integer, text, bytea, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.employee_module_data_anonymise() from public, anon, authenticated, service_role;

revoke all on function public.rpc_set_org_module(uuid, text, boolean, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rpc_set_employee_module_data(uuid, text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_clock(text, uuid, uuid, timestamptz, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_kiosk_clock(text, uuid, text, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_clock_offline(text, uuid, uuid, timestamptz, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text, text)
  from public, anon, authenticated, service_role;

grant execute on function public.rpc_set_org_module(uuid, text, boolean, jsonb) to authenticated;
grant execute on function public.rpc_set_employee_module_data(uuid, text, jsonb) to authenticated;
grant execute on function public.rpc_clock(text, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.rpc_clock_offline(text, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text, text)
  to authenticated;
-- The kiosk calls this without a session; authenticated too (the JWT is ignored).
grant execute on function public.rpc_kiosk_clock(text, uuid, text, text, uuid, text) to anon, authenticated;
