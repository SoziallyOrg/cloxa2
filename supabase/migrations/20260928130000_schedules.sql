-- Versioned work schedules (docs/architecture.md, "schedules").
--
-- A schedule is never overwritten: every change appends a new version with a
-- valid_from date. The version in force on a day is the one with the latest
-- valid_from on or before that day (highest version number on ties). Rows are
-- append-only through triggers; the audit chain records who set what.
--
-- pattern is a weekly template plus optional per-date exceptions:
--   { "mon": [{"start": "08:00", "end": "12:00"}, ...], ...,
--     "exceptions": [{"date": "2026-12-24", "blocks": [...]}] }
-- Blocks are local wall-clock times in the organization timezone. Within one
-- day they are sorted and non-overlapping; only the last block may cross
-- midnight (end < start), and "24:00" is allowed as an end.

-- Minutes since local midnight for 'HH:MM' (00:00-23:59), or 1440 for '24:00'
-- when p_allow_24 is set. Null for anything else.
create function private.schedule_minutes(p_value text, p_allow_24 boolean)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      then pg_catalog.split_part(p_value, ':', 1)::integer * 60 + pg_catalog.split_part(p_value, ':', 2)::integer
    when p_allow_24 and p_value = '24:00' then 1440
  end;
$$;

create function private.is_valid_schedule_blocks(p_blocks jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_block jsonb;
  v_start integer;
  v_end integer;
  v_previous_end integer := -1;
  v_crossed boolean := false;
begin
  if p_blocks is null or jsonb_typeof(p_blocks) <> 'array' or jsonb_array_length(p_blocks) > 6 then
    return false;
  end if;

  for v_block in select block.value from pg_catalog.jsonb_array_elements(p_blocks) as block loop
    if jsonb_typeof(v_block) <> 'object'
      or jsonb_typeof(v_block -> 'start') is distinct from 'string'
      or jsonb_typeof(v_block -> 'end') is distinct from 'string'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_block) as block_key (name)
        where block_key.name not in ('start', 'end')
      )
    then
      return false;
    end if;

    v_start := private.schedule_minutes(v_block ->> 'start', false);
    v_end := private.schedule_minutes(v_block ->> 'end', true);

    -- A block after an overnight block, a zero-length block, or one that
    -- starts before the previous block ended is invalid.
    if v_start is null or v_end is null or v_crossed or v_start = v_end or v_start < v_previous_end then
      return false;
    end if;

    v_crossed := v_end < v_start;
    v_previous_end := v_end;
  end loop;

  return true;
end;
$$;

create function private.is_valid_schedule_pattern(p_pattern jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_day text;
  v_exception jsonb;
  v_date text;
  v_dates text[] := '{}'::text[];
begin
  if p_pattern is null
    or jsonb_typeof(p_pattern) <> 'object'
    or octet_length(p_pattern::text) > 16384
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_pattern) as pattern_key (name)
      where pattern_key.name not in ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'exceptions')
    )
  then
    return false;
  end if;

  foreach v_day in array array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] loop
    if p_pattern ? v_day and not private.is_valid_schedule_blocks(p_pattern -> v_day) then
      return false;
    end if;
  end loop;

  if not p_pattern ? 'exceptions' then
    return true;
  end if;

  if jsonb_typeof(p_pattern -> 'exceptions') <> 'array'
    or jsonb_array_length(p_pattern -> 'exceptions') > 100
  then
    return false;
  end if;

  for v_exception in
    select exception_entry.value
    from pg_catalog.jsonb_array_elements(p_pattern -> 'exceptions') as exception_entry
  loop
    if jsonb_typeof(v_exception) <> 'object'
      or jsonb_typeof(v_exception -> 'date') is distinct from 'string'
      or exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_exception) as exception_key (name)
        where exception_key.name not in ('date', 'blocks')
      )
      or not private.is_valid_schedule_blocks(v_exception -> 'blocks')
    then
      return false;
    end if;

    v_date := v_exception ->> 'date';
    if v_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or v_date = any (v_dates) then
      return false;
    end if;

    begin
      perform pg_catalog.make_date(
        pg_catalog.split_part(v_date, '-', 1)::integer,
        pg_catalog.split_part(v_date, '-', 2)::integer,
        pg_catalog.split_part(v_date, '-', 3)::integer
      );
    exception
      when others then
        return false;
    end;

    v_dates := v_dates || v_date;
  end loop;

  return true;
end;
$$;

comment on function private.is_valid_schedule_pattern(jsonb) is
  'Shape check for schedules.pattern: weekday keys and exceptions only, bounded size, sorted non-overlapping HH:MM blocks.';

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  employee_id uuid not null,
  -- Monotonic per employee, so versions never tie.
  version integer not null,
  valid_from date not null,
  pattern jsonb not null,
  -- Server time the version was published to the employee (visible in the app).
  notified_at timestamptz,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  constraint schedules_organization_id_id_key unique (organization_id, id),
  constraint schedules_employee_version_key unique (organization_id, employee_id, version),
  constraint schedules_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint schedules_version_check check (version > 0),
  constraint schedules_pattern_check check (private.is_valid_schedule_pattern(pattern))
);

comment on table public.schedules is
  'Append-only schedule versions per employee. The latest valid_from on or before a day is in force.';

create index schedules_employee_valid_from_idx
  on public.schedules (organization_id, employee_id, valid_from desc, version desc);

create trigger schedules_reject_update_delete
before update or delete on public.schedules
for each row execute function private.reject_mutation();

create trigger schedules_reject_truncate
before truncate on public.schedules
for each statement execute function private.reject_mutation();

-- rpc_set_schedule -------------------------------------------------------------------

create function private.set_schedule(p_employee_id uuid, p_valid_from date, p_pattern jsonb)
returns public.schedules
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_schedule public.schedules;
begin
  select employee.organization_id
  into v_organization_id
  from public.employees as employee
  where employee.id = p_employee_id
    and employee.active;

  -- Unknown, inactive and foreign employees look the same.
  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.require_privileged(v_organization_id);

  -- Managers only reach employees on a managed site; owners and admins the org.
  if not private.can_see_employee(p_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_valid_from is null
    or p_valid_from < current_date - 366
    or p_valid_from > current_date + 731
  then
    raise exception using errcode = '22023', message = 'invalid_valid_from';
  end if;

  if not coalesce(private.is_valid_schedule_pattern(p_pattern), false) then
    raise exception using errcode = '22023', message = 'invalid_schedule_pattern';
  end if;

  -- Two concurrent versions for one employee collide on the unique version
  -- key instead of silently tying.
  insert into public.schedules (
    organization_id, employee_id, version, valid_from, pattern, notified_at, created_by
  )
  values (
    v_organization_id,
    p_employee_id,
    coalesce((
      select pg_catalog.max(existing.version)
      from public.schedules as existing
      where existing.organization_id = v_organization_id
        and existing.employee_id = p_employee_id
    ), 0) + 1,
    p_valid_from,
    p_pattern,
    pg_catalog.clock_timestamp(),
    (select auth.uid())
  )
  returning * into v_schedule;

  perform private.write_audit(
    v_organization_id,
    'schedule.set',
    'schedule',
    v_schedule.id,
    pg_catalog.jsonb_build_object(
      'employee_id', p_employee_id,
      'version', v_schedule.version,
      'valid_from', v_schedule.valid_from
    )
  );

  return v_schedule;
end;
$$;

-- rpc_schedule_for -------------------------------------------------------------------

-- Planned blocks per local day, as absolute instants. Local wall times are
-- converted in the organization timezone, so DST days get their real length.
-- A local time that does not exist (spring-forward gap) moves forward by the
-- gap; an ambiguous one (fall-back) resolves to the later, standard-time
-- instant. Blocks that collapse to zero length in the gap are dropped.
create function private.schedule_for(p_employee_id uuid, p_from date, p_to date)
returns table (day date, start_at timestamptz, end_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_timezone text;
begin
  if p_employee_id is null or not private.can_see_employee(p_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 then
    raise exception using errcode = '22023', message = 'invalid_range';
  end if;

  select employee.organization_id, organization.timezone
  into v_organization_id, v_timezone
  from public.employees as employee
  join public.organizations as organization
    on organization.id = employee.organization_id
  where employee.id = p_employee_id;

  return query
  with days as (
    select series.value::date as local_day
    from pg_catalog.generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') as series (value)
  ),
  versions as (
    select days.local_day, version.pattern
    from days
    cross join lateral (
      select schedule.pattern
      from public.schedules as schedule
      where schedule.organization_id = v_organization_id
        and schedule.employee_id = p_employee_id
        and schedule.valid_from <= days.local_day
      order by schedule.valid_from desc, schedule.version desc
      limit 1
    ) as version
  ),
  blocks as (
    select
      versions.local_day,
      private.schedule_minutes(block.value ->> 'start', false) as start_minutes,
      private.schedule_minutes(block.value ->> 'end', true) as end_minutes
    from versions
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(
        (
          select exception_entry.value -> 'blocks'
          from pg_catalog.jsonb_array_elements(
            coalesce(versions.pattern -> 'exceptions', '[]'::jsonb)
          ) as exception_entry
          where exception_entry.value ->> 'date' = pg_catalog.to_char(versions.local_day, 'YYYY-MM-DD')
          limit 1
        ),
        versions.pattern -> (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[
          extract(isodow from versions.local_day)::integer
        ],
        '[]'::jsonb
      )
    ) as block
  ),
  instants as (
    select
      blocks.local_day,
      (blocks.local_day + pg_catalog.make_interval(mins => blocks.start_minutes)) at time zone v_timezone
        as block_start,
      (
        blocks.local_day
        + pg_catalog.make_interval(
          mins => blocks.end_minutes + case when blocks.end_minutes < blocks.start_minutes then 1440 else 0 end
        )
      ) at time zone v_timezone as block_end
    from blocks
  )
  select instants.local_day, instants.block_start, instants.block_end
  from instants
  where instants.block_end > instants.block_start
  order by instants.block_start;
end;
$$;

-- Public wrappers ----------------------------------------------------------------------

create function public.rpc_set_schedule(p_employee_id uuid, p_valid_from date, p_pattern jsonb)
returns public.schedules
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.set_schedule(p_employee_id, p_valid_from, p_pattern);
$$;

comment on function public.rpc_set_schedule(uuid, date, jsonb) is
  'Privileged (fresh MFA): append a new schedule version for a visible employee.';

create function public.rpc_schedule_for(p_employee_id uuid, p_from date, p_to date)
returns table (day date, start_at timestamptz, end_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.schedule_for(p_employee_id, p_from, p_to);
$$;

comment on function public.rpc_schedule_for(uuid, date, date) is
  'Planned blocks per local day (at most 93 days), expanded in the organization timezone.';

alter table public.schedules enable row level security;

revoke all on table public.schedules from public, anon, authenticated, service_role;
grant select on table public.schedules to authenticated, service_role;

create policy schedules_select_visible
on public.schedules
for select
to authenticated
using (private.can_see_employee(employee_id));

revoke all on function private.schedule_minutes(text, boolean) from public, anon, authenticated, service_role;
revoke all on function private.is_valid_schedule_blocks(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.is_valid_schedule_pattern(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.set_schedule(uuid, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function private.schedule_for(uuid, date, date) from public, anon, authenticated, service_role;
revoke all on function public.rpc_set_schedule(uuid, date, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.rpc_schedule_for(uuid, date, date) from public, anon, authenticated, service_role;

grant execute on function public.rpc_set_schedule(uuid, date, jsonb) to authenticated;
grant execute on function public.rpc_schedule_for(uuid, date, date) to authenticated;
