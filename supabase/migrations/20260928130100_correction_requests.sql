-- Correction requests and approval (docs/architecture.md, "correction_requests").
--
-- An employee asks to add, adjust or remove their own effective clock events.
-- A privileged member (fresh MFA, manager-scoped) decides. Approval never edits
-- an event: it appends superseding events with source 'correction' (a 'void'
-- for removals) and re-validates the employee's whole affected period with the
-- live transition rules, all inside one transaction under the per-employee
-- lock. Lock order: 1003 (employee) -> 1002 (clock chain) -> 1001 (audit chain).
--
-- proposed = {"events": [...]}, by kind:
--   add:    1-8 of {"type", "occurred_at", "site_id"}, no targets
--   adjust: one {"target_event_id", "occurred_at"} per target (type and site kept)
--   remove: no events; every target is voided
-- occurred_at is ISO 8601 with an explicit offset. Stored normalized.

-- Org setting: how far back a correction may reach (days, default 60).
alter table public.organizations
  add constraint organizations_correction_max_age_check check (
    case
      when jsonb_typeof(settings) <> 'object' then false
      when not settings ? 'correction_max_age_days' then true
      when jsonb_typeof(settings -> 'correction_max_age_days') <> 'number' then false
      else (settings -> 'correction_max_age_days')::numeric between 1 and 365
        and (settings -> 'correction_max_age_days')::numeric
          = pg_catalog.trunc((settings -> 'correction_max_age_days')::numeric)
    end
  );

create function private.correction_max_age_days(p_organization_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select (organization.settings -> 'correction_max_age_days')::numeric::integer
      from public.organizations as organization
      where organization.id = p_organization_id
    ),
    60
  );
$$;

-- The live transition rules (private.clock) as a function: the next state, or
-- null when the event is not allowed in p_state.
create function private.clock_next_state(p_state text, p_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_type = 'clock_in' and p_state = 'off' then 'working'
    when p_type = 'clock_out' and p_state = 'working' then 'off'
    when p_type = 'break_start' and p_state = 'working' then 'on_break'
    when p_type = 'break_end' and p_state = 'on_break' then 'working'
  end;
$$;

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  employee_id uuid not null,
  requested_by uuid not null,
  kind text not null,
  target_event_ids uuid[] not null default '{}',
  proposed jsonb not null default '{}'::jsonb,
  -- Free text for the decider only; never copied into audit metadata.
  reason text not null,
  status text not null default 'pending',
  created_at timestamptz not null default clock_timestamp(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  constraint correction_requests_organization_id_id_key unique (organization_id, id),
  constraint correction_requests_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint correction_requests_kind_check check (kind in ('add', 'adjust', 'remove')),
  constraint correction_requests_status_check
    check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint correction_requests_targets_check check (
    cardinality(target_event_ids) <= 10
    and array_position(target_event_ids, null) is null
    and (kind = 'add') = (cardinality(target_event_ids) = 0)
  ),
  constraint correction_requests_proposed_check
    check (jsonb_typeof(proposed) = 'object' and octet_length(proposed::text) <= 4096),
  constraint correction_requests_reason_check
    check (btrim(reason) <> '' and char_length(reason) <= 280),
  constraint correction_requests_decision_note_check
    check (decision_note is null or (btrim(decision_note) <> '' and char_length(decision_note) <= 280)),
  constraint correction_requests_decision_check check (
    case
      when status = 'pending' then decided_by is null and decided_at is null and decision_note is null
      else decided_by is not null and decided_at is not null
    end
  )
);

comment on table public.correction_requests is
  'Employee requests to add/adjust/remove own clock events. Immutable once decided; approval appends events.';

create index correction_requests_employee_status_idx
  on public.correction_requests (organization_id, employee_id, status, created_at desc);
create index correction_requests_status_idx
  on public.correction_requests (organization_id, status, created_at desc);

alter table public.clock_events
  add constraint clock_events_correction_fkey
    foreign key (organization_id, correction_id)
    references public.correction_requests (organization_id, id) on delete restrict;

-- Only the decision of a pending request may change, exactly once.
create function private.correction_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status <> 'pending' then
    raise exception using errcode = '55000', message = 'correction_requests is immutable after decision';
  end if;

  if new.status = 'pending'
    or (new.id, new.organization_id, new.employee_id, new.requested_by, new.kind, new.target_event_ids,
        new.proposed, new.reason, new.created_at)
      is distinct from
       (old.id, old.organization_id, old.employee_id, old.requested_by, old.kind, old.target_event_ids,
        old.proposed, old.reason, old.created_at)
  then
    raise exception using errcode = '55000', message = 'only the decision of a correction request may change';
  end if;

  return new;
end;
$$;

create trigger correction_requests_guard
before update on public.correction_requests
for each row execute function private.correction_requests_guard();

create trigger correction_requests_reject_delete
before delete on public.correction_requests
for each row execute function private.reject_mutation();

create trigger correction_requests_reject_truncate
before truncate on public.correction_requests
for each statement execute function private.reject_mutation();

-- Helpers ----------------------------------------------------------------------------

-- ISO 8601 with an explicit offset (so the session TimeZone never matters),
-- or null when the value is anything else.
create function private.parse_proposed_time(p_value jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string'
    or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
  then
    return null;
  end if;

  return (p_value #>> '{}')::timestamptz;
exception
  when invalid_datetime_format or datetime_field_overflow then
    return null;
end;
$$;

-- Replays the employee's effective events as they would be after removing
-- p_removed and adding p_added ([{type, occurred_at}]), from the earliest
-- affected instant to the end, with the live transition rules. Returns null
-- when valid, otherwise a description of the first invalid transition.
-- Added events sort after existing ones at the same instant, exactly as they
-- will once appended (their server_at is later).
create function private.correction_sequence_problem(
  p_organization_id uuid,
  p_employee_id uuid,
  p_removed uuid[],
  p_added jsonb
)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_removed uuid[] := coalesce(p_removed, '{}');
  v_from timestamptz;
  v_state text;
  v_next text;
  v_event record;
begin
  select pg_catalog.min(affected.at)
  into v_from
  from (
    select event.occurred_at as at
    from public.clock_events as event
    where event.organization_id = p_organization_id
      and event.id = any (v_removed)
    union all
    select (added.value ->> 'occurred_at')::timestamptz
    from pg_catalog.jsonb_array_elements(coalesce(p_added, '[]'::jsonb)) as added (value)
  ) as affected;

  if v_from is null then
    return null;
  end if;

  select private.clock_state_after(prior.type)
  into v_state
  from public.clock_events as prior
  where prior.organization_id = p_organization_id
    and prior.employee_id = p_employee_id
    and prior.type <> 'void'
    and prior.occurred_at < v_from
    and not (prior.id = any (v_removed))
    and not exists (
      select 1
      from public.clock_events as superseding
      where superseding.supersedes_event_id = prior.id
    )
  order by prior.occurred_at desc, prior.server_at desc, prior.id desc
  limit 1;

  v_state := coalesce(v_state, 'off');

  for v_event in
    select merged.type, merged.occurred_at
    from (
      select
        event.type,
        event.occurred_at,
        event.server_at,
        event.id::text as tiebreak,
        0::bigint as ordinal
      from public.clock_events as event
      where event.organization_id = p_organization_id
        and event.employee_id = p_employee_id
        and event.type <> 'void'
        and event.occurred_at >= v_from
        and not (event.id = any (v_removed))
        and not exists (
          select 1
          from public.clock_events as superseding
          where superseding.supersedes_event_id = event.id
        )
      union all
      select
        added.value ->> 'type',
        (added.value ->> 'occurred_at')::timestamptz,
        'infinity'::timestamptz,
        '',
        added.ordinal
      from pg_catalog.jsonb_array_elements(coalesce(p_added, '[]'::jsonb)) with ordinality as added (value, ordinal)
    ) as merged
    order by merged.occurred_at, merged.server_at, merged.tiebreak, merged.ordinal
  loop
    v_next := private.clock_next_state(v_state, v_event.type);
    if v_next is null then
      return pg_catalog.format(
        'state=%s type=%s occurred_at=%s',
        v_state,
        v_event.type,
        private.epoch_us(v_event.occurred_at)
      );
    end if;
    v_state := v_next;
  end loop;

  return null;
end;
$$;

-- rpc_request_correction -------------------------------------------------------------

create function private.request_correction(
  p_kind text,
  p_target_event_ids uuid[],
  p_proposed jsonb,
  p_reason text
)
returns public.correction_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_targets uuid[] := coalesce(p_target_event_ids, '{}');
  v_events jsonb;
  v_event jsonb;
  v_time timestamptz;
  v_site_ids uuid[] := '{}'::uuid[];
  v_adjusted uuid[] := '{}'::uuid[];
  v_normalized jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_organization_id uuid;
  v_target_employee_id uuid;
  v_employee_id uuid;
  v_oldest_allowed timestamptz;
  v_problem text;
  v_request public.correction_requests;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_kind is null or p_kind not in ('add', 'adjust', 'remove') then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' or pg_catalog.char_length(p_reason) > 280 then
    raise exception using errcode = '22023', message = 'invalid_reason';
  end if;

  if cardinality(v_targets) > 10
    or array_position(v_targets, null) is not null
    or (select pg_catalog.count(distinct target.id) from pg_catalog.unnest(v_targets) as target (id))
      <> cardinality(v_targets)
    or (p_kind = 'add') <> (cardinality(v_targets) = 0)
  then
    raise exception using errcode = '22023', message = 'invalid_targets';
  end if;

  if p_proposed is null
    or jsonb_typeof(p_proposed) <> 'object'
    or octet_length(p_proposed::text) > 4096
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_proposed) as proposed_key (name)
      where proposed_key.name <> 'events'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_proposal';
  end if;

  v_events := coalesce(p_proposed -> 'events', '[]'::jsonb);

  if jsonb_typeof(v_events) <> 'array'
    or (p_kind = 'remove' and jsonb_array_length(v_events) <> 0)
    or (p_kind = 'add' and jsonb_array_length(v_events) not between 1 and 8)
    or (p_kind = 'adjust' and jsonb_array_length(v_events) <> cardinality(v_targets))
  then
    raise exception using errcode = '22023', message = 'invalid_proposal';
  end if;

  -- Shape of every proposed event; times are range-checked once the org is known.
  for v_event in select item.value from pg_catalog.jsonb_array_elements(v_events) as item (value) loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_proposal';
    end if;

    v_time := private.parse_proposed_time(v_event -> 'occurred_at');
    if v_time is null or v_time in ('infinity', '-infinity') then
      raise exception using errcode = '22023', message = 'invalid_proposed_time';
    end if;

    if p_kind = 'add' then
      if exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_event) as event_key (name)
          where event_key.name not in ('type', 'occurred_at', 'site_id')
        )
        or (v_event ->> 'type') is null
        or (v_event ->> 'type') not in ('clock_in', 'clock_out', 'break_start', 'break_end')
        or jsonb_typeof(v_event -> 'site_id') is distinct from 'string'
        or (v_event ->> 'site_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception using errcode = '22023', message = 'invalid_proposal';
      end if;

      v_site_ids := v_site_ids || (v_event ->> 'site_id')::uuid;
      v_normalized := v_normalized || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', v_event ->> 'type',
        'occurred_at', v_time,
        'site_id', (v_event ->> 'site_id')::uuid
      ));
    else
      if exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_event) as event_key (name)
          where event_key.name not in ('target_event_id', 'occurred_at')
        )
        or jsonb_typeof(v_event -> 'target_event_id') is distinct from 'string'
        or (v_event ->> 'target_event_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not ((v_event ->> 'target_event_id')::uuid = any (v_targets))
        or (v_event ->> 'target_event_id')::uuid = any (v_adjusted)
      then
        raise exception using errcode = '22023', message = 'invalid_proposal';
      end if;

      v_adjusted := v_adjusted || (v_event ->> 'target_event_id')::uuid;
      v_normalized := v_normalized || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'target_event_id', (v_event ->> 'target_event_id')::uuid,
        'occurred_at', v_time
      ));
    end if;
  end loop;

  -- The organization comes from the targets (adjust/remove) or the sites
  -- (add). Unknown ids and other people's events look the same.
  if p_kind = 'add' then
    select pg_catalog.min(site.organization_id::text)::uuid
    into v_organization_id
    from public.sites as site
    where site.id = any (v_site_ids);

    if v_organization_id is null or exists (
      select 1
      from pg_catalog.unnest(v_site_ids) as requested (site_id)
      where not exists (
        select 1
        from public.sites as site
        where site.id = requested.site_id
          and site.organization_id = v_organization_id
      )
    ) then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
  else
    select pg_catalog.min(event.organization_id::text)::uuid, pg_catalog.min(event.employee_id::text)::uuid
    into v_organization_id, v_target_employee_id
    from public.clock_events as event
    where event.id = any (v_targets);

    if v_organization_id is null or (
      select pg_catalog.count(*)
      from public.clock_events as event
      where event.id = any (v_targets)
        and event.organization_id = v_organization_id
        and event.employee_id = v_target_employee_id
    ) <> cardinality(v_targets) then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
  end if;

  -- The caller acts for themselves only.
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

  if not found or (p_kind <> 'add' and v_employee_id <> v_target_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_kind = 'add' and exists (
    select 1
    from pg_catalog.unnest(v_site_ids) as requested (site_id)
    where not exists (
      select 1
      from public.site_assignments as assignment
      where assignment.organization_id = v_organization_id
        and assignment.site_id = requested.site_id
        and assignment.employee_id = v_employee_id
    )
  ) then
    raise exception using errcode = '42501', message = 'site_not_assigned';
  end if;

  if exists (
    select 1
    from public.clock_events as event
    where event.id = any (v_targets)
      and (
        event.type = 'void'
        or exists (
          select 1
          from public.clock_events as superseding
          where superseding.supersedes_event_id = event.id
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'target_not_effective';
  end if;

  v_oldest_allowed := v_now - pg_catalog.make_interval(days => private.correction_max_age_days(v_organization_id));

  if exists (
    select 1
    from public.clock_events as event
    where event.id = any (v_targets)
      and event.occurred_at < v_oldest_allowed
  ) then
    raise exception using errcode = '22023', message = 'target_too_old';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized) as item (value)
    where (item.value ->> 'occurred_at')::timestamptz > v_now
  ) then
    raise exception using errcode = '22023', message = 'proposed_time_in_future';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized) as item (value)
    where (item.value ->> 'occurred_at')::timestamptz < v_oldest_allowed
  ) then
    raise exception using errcode = '22023', message = 'proposed_time_too_old';
  end if;

  -- Early feedback only; approval re-validates under the employee lock.
  if p_kind = 'add' then
    v_added := v_normalized;
  elsif p_kind = 'adjust' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', event.type,
      'occurred_at', item.value -> 'occurred_at'
    ) order by item.ordinal), '[]'::jsonb)
    into v_added
    from pg_catalog.jsonb_array_elements(v_normalized) with ordinality as item (value, ordinal)
    join public.clock_events as event
      on event.id = (item.value ->> 'target_event_id')::uuid;
  end if;

  v_problem := private.correction_sequence_problem(v_organization_id, v_employee_id, v_targets, v_added);
  if v_problem is not null then
    raise exception using errcode = 'P0001', message = 'invalid_sequence', detail = v_problem;
  end if;

  if (
    select pg_catalog.count(*)
    from public.correction_requests as pending
    where pending.organization_id = v_organization_id
      and pending.employee_id = v_employee_id
      and pending.status = 'pending'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'too_many_pending';
  end if;

  insert into public.correction_requests (
    organization_id, employee_id, requested_by, kind, target_event_ids, proposed, reason
  )
  values (
    v_organization_id,
    v_employee_id,
    v_user_id,
    p_kind,
    v_targets,
    pg_catalog.jsonb_build_object('events', v_normalized),
    p_reason
  )
  returning * into v_request;

  perform private.write_audit(
    v_organization_id,
    'correction_request.created',
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee_id,
      'kind', p_kind,
      'target_count', cardinality(v_targets),
      'event_count', jsonb_array_length(v_normalized)
    )
  );

  return v_request;
end;
$$;

-- rpc_withdraw_correction ------------------------------------------------------------

create function private.withdraw_correction(p_id uuid)
returns public.correction_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_request public.correction_requests;
begin
  select request.*
  into v_request
  from public.correction_requests as request
  join public.employees as employee
    on employee.organization_id = request.organization_id
   and employee.id = request.employee_id
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  where request.id = p_id
    and v_user_id is not null
    and employee.user_id = v_user_id
    and membership.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- Same lock as a decision, so withdraw and approve serialize.
  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_request.employee_id::text));

  select request.*
  into v_request
  from public.correction_requests as request
  where request.id = p_id
  for update;

  if v_request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'correction_not_pending';
  end if;

  update public.correction_requests as request
  set status = 'withdrawn',
      decided_by = v_user_id,
      decided_at = pg_catalog.clock_timestamp()
  where request.id = p_id
  returning * into v_request;

  perform private.write_audit(
    v_request.organization_id,
    'correction_request.withdrawn',
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object('employee_id', v_request.employee_id, 'kind', v_request.kind)
  );

  return v_request;
end;
$$;

-- rpc_decide_correction --------------------------------------------------------------

create function private.decide_correction(p_id uuid, p_decision text, p_note text default null)
returns public.correction_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_employee_id uuid;
  v_membership public.memberships;
  v_request public.correction_requests;
  v_item record;
  v_target public.clock_events;
  v_event public.clock_events;
  v_added jsonb := '[]'::jsonb;
  v_problem text;
  v_event_count integer := 0;
begin
  select request.organization_id, request.employee_id
  into v_organization_id, v_employee_id
  from public.correction_requests as request
  where request.id = p_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_membership := private.require_privileged(v_organization_id);

  if not private.can_see_employee(v_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- A manager never decides their own request; an owner or admin must.
  if v_membership.role = 'manager' and exists (
    select 1
    from public.employees as employee
    where employee.id = v_employee_id
      and employee.user_id = v_user_id
  ) then
    raise exception using errcode = '42501', message = 'self_decision_not_allowed';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_decision';
  end if;

  if p_note is not null and (pg_catalog.btrim(p_note) = '' or pg_catalog.char_length(p_note) > 280) then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;

  -- Lock order: employee (1003) first; the clock chain (1002) and audit chain
  -- (1001) locks follow through the append triggers.
  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_employee_id::text));

  select request.*
  into v_request
  from public.correction_requests as request
  where request.id = p_id
  for update;

  if v_request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'correction_not_pending';
  end if;

  if p_decision = 'approved' then
    -- Targets must still be the employee's effective events.
    if (
      select pg_catalog.count(*)
      from public.clock_events as event
      where event.id = any (v_request.target_event_ids)
        and event.organization_id = v_request.organization_id
        and event.employee_id = v_request.employee_id
        and event.type <> 'void'
        and not exists (
          select 1
          from public.clock_events as superseding
          where superseding.supersedes_event_id = event.id
        )
    ) <> cardinality(v_request.target_event_ids) then
      raise exception using errcode = '55000', message = 'target_not_effective';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_request.proposed -> 'events') as item (value)
      where (item.value ->> 'occurred_at')::timestamptz > pg_catalog.clock_timestamp()
    ) then
      raise exception using errcode = '22023', message = 'proposed_time_in_future';
    end if;

    if v_request.kind = 'add' then
      v_added := v_request.proposed -> 'events';
    elsif v_request.kind = 'adjust' then
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', event.type,
        'occurred_at', item.value -> 'occurred_at'
      ) order by item.ordinal), '[]'::jsonb)
      into v_added
      from pg_catalog.jsonb_array_elements(v_request.proposed -> 'events') with ordinality as item (value, ordinal)
      join public.clock_events as event
        on event.id = (item.value ->> 'target_event_id')::uuid;
    end if;

    v_problem := private.correction_sequence_problem(
      v_request.organization_id, v_request.employee_id, v_request.target_event_ids, v_added
    );
    if v_problem is not null then
      raise exception using errcode = 'P0001', message = 'invalid_sequence', detail = v_problem;
    end if;

    -- Append. One row per event: add -> new event, adjust -> superseding
    -- event of the same type and site, remove -> void at the original time.
    for v_item in
      select
        case v_request.kind when 'add' then item.value ->> 'type' else null end as type,
        case v_request.kind when 'add' then (item.value ->> 'site_id')::uuid else null end as site_id,
        (item.value ->> 'occurred_at')::timestamptz as occurred_at,
        (item.value ->> 'target_event_id')::uuid as target_event_id
      from pg_catalog.jsonb_array_elements(
        case v_request.kind
          when 'remove' then (
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('target_event_id', target.id) order by target.ordinal)
            from pg_catalog.unnest(v_request.target_event_ids) with ordinality as target (id, ordinal)
          )
          else v_request.proposed -> 'events'
        end
      ) with ordinality as item (value, ordinal)
      order by item.ordinal
    loop
      if v_item.target_event_id is not null then
        select event.*
        into v_target
        from public.clock_events as event
        where event.id = v_item.target_event_id;
      end if;

      insert into public.clock_events (
        organization_id,
        site_id,
        employee_id,
        type,
        occurred_at,
        server_at,
        source,
        supersedes_event_id,
        correction_id,
        actor_user_id,
        idempotency_key
      )
      values (
        v_request.organization_id,
        case v_request.kind when 'add' then v_item.site_id else v_target.site_id end,
        v_request.employee_id,
        case v_request.kind when 'add' then v_item.type when 'adjust' then v_target.type else 'void' end,
        case v_request.kind when 'remove' then v_target.occurred_at else v_item.occurred_at end,
        pg_catalog.clock_timestamp(),
        'correction',
        case v_request.kind when 'add' then null else v_target.id end,
        v_request.id,
        v_user_id,
        gen_random_uuid()
      )
      returning * into v_event;

      perform private.write_audit(
        v_request.organization_id,
        'clock_event.recorded',
        'clock_event',
        v_event.id,
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'employee_id', v_event.employee_id,
          'site_id', v_event.site_id,
          'type', v_event.type,
          'source', 'correction',
          'correction_id', v_request.id,
          'supersedes_event_id', v_event.supersedes_event_id
        ))
      );

      v_event_count := v_event_count + 1;
    end loop;
  end if;

  update public.correction_requests as request
  set status = p_decision,
      decided_by = v_user_id,
      decided_at = pg_catalog.clock_timestamp(),
      decision_note = p_note
  where request.id = p_id
  returning * into v_request;

  perform private.write_audit(
    v_request.organization_id,
    'correction_request.' || p_decision,
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_request.employee_id,
      'kind', v_request.kind,
      'event_count', v_event_count
    )
  );

  return v_request;
end;
$$;

-- Public wrappers ----------------------------------------------------------------------

create function public.rpc_request_correction(
  p_kind text,
  p_target_event_ids uuid[],
  p_proposed jsonb,
  p_reason text
)
returns public.correction_requests
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.request_correction(p_kind, p_target_event_ids, p_proposed, p_reason);
$$;

comment on function public.rpc_request_correction(text, uuid[], jsonb, text) is
  'Employee: request to add/adjust/remove own effective events (not in the future, within the org max age).';

create function public.rpc_withdraw_correction(p_id uuid)
returns public.correction_requests
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.withdraw_correction(p_id);
$$;

comment on function public.rpc_withdraw_correction(uuid) is
  'Employee: withdraw own pending correction request.';

create function public.rpc_decide_correction(p_id uuid, p_decision text, p_note text default null)
returns public.correction_requests
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.decide_correction(p_id, p_decision, p_note);
$$;

comment on function public.rpc_decide_correction(uuid, text, text) is
  'Privileged (fresh MFA, manager-scoped, never own as manager): approve (appends events) or reject a pending request.';

alter table public.correction_requests enable row level security;

revoke all on table public.correction_requests from public, anon, authenticated, service_role;
grant select on table public.correction_requests to authenticated, service_role;

create policy correction_requests_select_visible
on public.correction_requests
for select
to authenticated
using (private.can_see_employee(employee_id));

revoke all on function private.correction_max_age_days(uuid) from public, anon, authenticated, service_role;
revoke all on function private.clock_next_state(text, text) from public, anon, authenticated, service_role;
revoke all on function private.correction_requests_guard() from public, anon, authenticated, service_role;
revoke all on function private.parse_proposed_time(jsonb) from public, anon, authenticated, service_role;
revoke all on function private.correction_sequence_problem(uuid, uuid, uuid[], jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.request_correction(text, uuid[], jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function private.withdraw_correction(uuid) from public, anon, authenticated, service_role;
revoke all on function private.decide_correction(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_request_correction(text, uuid[], jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_withdraw_correction(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_decide_correction(uuid, text, text) from public, anon, authenticated, service_role;

grant execute on function public.rpc_request_correction(text, uuid[], jsonb, text) to authenticated;
grant execute on function public.rpc_withdraw_correction(uuid) to authenticated;
grant execute on function public.rpc_decide_correction(uuid, text, text) to authenticated;
