-- Manager-initiated corrections (ADR 010).
--
-- Until now only the employee could start a correction; a manager could only
-- decide. Kiosk-only staff (no login) had no way to get a forgotten clock-out
-- fixed. rpc_manager_correct lets a privileged member (fresh MFA,
-- manager-scoped) record a correction for an employee in one transaction:
--
--   1. a correction_requests row with origin = 'manager', the mandatory reason
--      and requested_by = the caller, validated by the same code as an
--      employee request;
--   2. the existing private.decide_correction(id, 'approved') on that row, so
--      re-validation, the appended events (source 'correction', correction_id,
--      actor = caller) and their audit rows are the ones approval always wrote.
--
-- No new clock_events.source and no change to the hash-chain canonical bytes.
-- Anything that fails raises, so a pending manager-origin row never remains.
-- Lock order as everywhere: 1003 (employee) -> 1002 (clock chain) -> 1001
-- (audit chain); decide_correction takes 1003 again, which is re-entrant
-- within one transaction. After 1003 both functions lock the employee row FOR
-- SHARE and re-check it, so an offboarding cannot commit in between.
--
-- A manager corrects employees (or people without a login) only; only an
-- owner corrects an owner (the rule of rpc_kiosk_set_pin). At most 60 manager
-- corrections per actor per hour.
--
-- The validation of rpc_request_correction moves into two shared helpers
-- (correction_parse, correction_check), so both paths run one copy. The only
-- change for employees: the reason is trimmed (tabs and newlines too) before
-- its length check and stored trimmed.

-- 1. Who started the correction ------------------------------------------------------------------

alter table public.correction_requests
  add column origin text not null default 'employee';
alter table public.correction_requests
  add constraint correction_requests_origin_check check (origin in ('employee', 'manager'));

-- The per-actor rate window of rpc_manager_correct.
create index correction_requests_manager_actor_idx
  on public.correction_requests (requested_by, created_at)
  where origin = 'manager';

comment on column public.correction_requests.origin is
  'employee: requested by the employee, decided by a privileged member. manager: recorded and approved in one step by requested_by (rpc_manager_correct).';
comment on table public.correction_requests is
  'Requests to add/adjust/remove an employee''s clock events, by the employee or (origin = manager) by a privileged member. Immutable once decided; approval appends events.';

-- Only the decision of a pending request may change, exactly once; origin
-- never does. The one exception is anonymisation (transaction-local flag, set
-- only inside private.anonymise_employee): it may clear reason and
-- decision_note and nothing else.
create or replace function private.correction_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('cloxa.anonymising', true), '') = 'on'
    and new.reason is null
    and new.decision_note is null
    and (new.id, new.organization_id, new.employee_id, new.requested_by, new.kind, new.target_event_ids,
         new.proposed, new.status, new.created_at, new.decided_by, new.decided_at, new.offline,
         new.idempotency_key, new.offline_reason, new.origin)
      is not distinct from
        (old.id, old.organization_id, old.employee_id, old.requested_by, old.kind, old.target_event_ids,
         old.proposed, old.status, old.created_at, old.decided_by, old.decided_at, old.offline,
         old.idempotency_key, old.offline_reason, old.origin)
  then
    return new;
  end if;

  if old.status <> 'pending' then
    raise exception using errcode = '55000', message = 'correction_requests is immutable after decision';
  end if;

  if new.status = 'pending'
    or (new.id, new.organization_id, new.employee_id, new.requested_by, new.kind, new.target_event_ids,
        new.proposed, new.reason, new.created_at, new.offline, new.idempotency_key, new.offline_reason, new.origin)
      is distinct from
       (old.id, old.organization_id, old.employee_id, old.requested_by, old.kind, old.target_event_ids,
        old.proposed, old.reason, old.created_at, old.offline, old.idempotency_key, old.offline_reason, old.origin)
  then
    raise exception using errcode = '55000', message = 'only the decision of a correction request may change';
  end if;

  return new;
end;
$$;

-- 2. Shared validation ---------------------------------------------------------------------------

-- Shape of a correction, before anyone's identity matters: kind, reason,
-- targets and proposal. Returns the trimmed reason (stored as such on both
-- paths; its length is checked after trimming), the normalized events and the
-- organization (and, for adjust/remove, the employee) the targets or sites
-- belong to. Unknown ids and other people's events look the same
-- (not_authorized).
create function private.correction_parse(
  p_kind text,
  p_target_event_ids uuid[],
  p_proposed jsonb,
  p_reason text,
  out o_organization_id uuid,
  out o_target_employee_id uuid,
  out o_targets uuid[],
  out o_site_ids uuid[],
  out o_events jsonb,
  out o_reason text
)
returns record
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_targets uuid[] := coalesce(p_target_event_ids, '{}');
  v_events jsonb;
  v_event jsonb;
  v_time timestamptz;
  v_site_ids uuid[] := '{}'::uuid[];
  v_adjusted uuid[] := '{}'::uuid[];
  v_normalized jsonb := '[]'::jsonb;
  v_organization_id uuid;
  v_target_employee_id uuid;
  v_reason text := pg_catalog.btrim(p_reason, E' \t\r\n');
begin
  if p_kind is null or p_kind not in ('add', 'adjust', 'remove') then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;

  if v_reason is null or v_reason = '' or pg_catalog.char_length(v_reason) > 280 then
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

  o_organization_id := v_organization_id;
  o_target_employee_id := v_target_employee_id;
  o_targets := v_targets;
  o_site_ids := v_site_ids;
  o_events := v_normalized;
  o_reason := v_reason;
end;
$$;

-- The rules a parsed correction must meet for one employee: assigned, active
-- sites, effective targets, the org's age window, no future times, no shared
-- instants and a valid sequence. Raises the machine code; returns nothing.
-- Early feedback for a request; approval re-validates under the employee lock.
create function private.correction_check(
  p_organization_id uuid,
  p_employee_id uuid,
  p_kind text,
  p_targets uuid[],
  p_site_ids uuid[],
  p_events jsonb,
  p_now timestamptz
)
returns void
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_added jsonb := '[]'::jsonb;
  v_oldest_allowed timestamptz;
  v_problem text;
begin
  if p_kind = 'add' and exists (
    select 1
    from pg_catalog.unnest(p_site_ids) as requested (site_id)
    where not exists (
      select 1
      from public.site_assignments as assignment
      where assignment.organization_id = p_organization_id
        and assignment.site_id = requested.site_id
        and assignment.employee_id = p_employee_id
    )
  ) then
    raise exception using errcode = '42501', message = 'site_not_assigned';
  end if;

  if p_kind = 'add' and exists (
    select 1
    from public.sites as site
    where site.id = any (p_site_ids)
      and not site.active
  ) then
    raise exception using errcode = '22023', message = 'site_inactive';
  end if;

  if exists (
    select 1
    from public.clock_events as event
    where event.id = any (p_targets)
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

  v_oldest_allowed := p_now - pg_catalog.make_interval(days => private.correction_max_age_days(p_organization_id));

  if exists (
    select 1
    from public.clock_events as event
    where event.id = any (p_targets)
      and event.occurred_at < v_oldest_allowed
  ) then
    raise exception using errcode = '22023', message = 'target_too_old';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_events) as item (value)
    where (item.value ->> 'occurred_at')::timestamptz > p_now
  ) then
    raise exception using errcode = '22023', message = 'proposed_time_in_future';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_events) as item (value)
    where (item.value ->> 'occurred_at')::timestamptz < v_oldest_allowed
  ) then
    raise exception using errcode = '22023', message = 'proposed_time_too_old';
  end if;

  v_problem := private.proposed_times_problem(p_organization_id, p_employee_id, p_events);
  if v_problem is not null then
    raise exception using errcode = '22023', message = v_problem;
  end if;

  -- Early feedback only; approval re-validates under the employee lock.
  if p_kind = 'add' then
    v_added := p_events;
  elsif p_kind = 'adjust' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', event.type,
      'occurred_at', item.value -> 'occurred_at'
    ) order by item.ordinal), '[]'::jsonb)
    into v_added
    from pg_catalog.jsonb_array_elements(p_events) with ordinality as item (value, ordinal)
    join public.clock_events as event
      on event.id = (item.value ->> 'target_event_id')::uuid;
  end if;

  v_problem := private.correction_sequence_problem(p_organization_id, p_employee_id, p_targets, v_added);
  if v_problem is not null then
    raise exception using errcode = 'P0001', message = 'invalid_sequence', detail = v_problem;
  end if;
end;
$$;

-- rpc_request_correction: same checks, same order, same codes as before. The
-- reason is now stored trimmed (tabs and newlines too).
create or replace function private.request_correction(
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
  v_parsed record;
  v_employee_id uuid;
  v_request public.correction_requests;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select parsed.*
  into v_parsed
  from private.correction_parse(p_kind, p_target_event_ids, p_proposed, p_reason) as parsed;

  -- The caller acts for themselves only.
  select employee.id
  into v_employee_id
  from public.employees as employee
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  where employee.organization_id = v_parsed.o_organization_id
    and employee.user_id = v_user_id
    and employee.active
    and membership.status = 'active';

  if not found or (p_kind <> 'add' and v_employee_id <> v_parsed.o_target_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.correction_check(
    v_parsed.o_organization_id, v_employee_id, p_kind, v_parsed.o_targets, v_parsed.o_site_ids,
    v_parsed.o_events, v_now
  );

  if (
    select pg_catalog.count(*)
    from public.correction_requests as pending
    where pending.organization_id = v_parsed.o_organization_id
      and pending.employee_id = v_employee_id
      and pending.status = 'pending'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'too_many_pending';
  end if;

  insert into public.correction_requests (
    organization_id, employee_id, requested_by, kind, target_event_ids, proposed, reason
  )
  values (
    v_parsed.o_organization_id,
    v_employee_id,
    v_user_id,
    p_kind,
    v_parsed.o_targets,
    pg_catalog.jsonb_build_object('events', v_parsed.o_events),
    v_parsed.o_reason
  )
  returning * into v_request;

  perform private.write_audit(
    v_parsed.o_organization_id,
    'correction_request.created',
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee_id,
      'kind', p_kind,
      'target_count', cardinality(v_parsed.o_targets),
      'event_count', jsonb_array_length(v_parsed.o_events)
    )
  );

  return v_request;
end;
$$;

-- rpc_decide_correction: as before, plus the employee row lock and re-check
-- after the 1003 lock (approval refuses employees who left or were
-- anonymised), and origin in the decision's audit row.
create or replace function private.decide_correction(p_id uuid, p_decision text, p_note text default null)
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
  v_employee public.employees;
  v_membership public.memberships;
  v_self boolean;
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

  -- Only an owner decides their own request (single-owner businesses); a
  -- manager or admin never does. Recorded as self_decided in the audit row.
  v_self := exists (
    select 1
    from public.employees as employee
    where employee.id = v_employee_id
      and employee.user_id = v_user_id
  );

  if v_self and v_membership.role <> 'owner' then
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

  -- Then the employee row, FOR SHARE to commit: offboarding and anonymisation
  -- lock it FOR UPDATE, so neither can commit between these checks and the
  -- appended events. No path takes 1003 after an employees row lock.
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = v_employee_id
  for share;

  if not found or v_employee.organization_id <> v_organization_id then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- The self rule again, on the locked row (a login may have been linked).
  v_self := v_employee.user_id is not distinct from v_user_id;
  if v_self and v_membership.role <> 'owner' then
    raise exception using errcode = '42501', message = 'self_decision_not_allowed';
  end if;

  -- No events are appended for someone who left or was anonymised. A
  -- rejection appends nothing, so it stays possible.
  if p_decision = 'approved' and v_employee.anonymised_at is not null then
    raise exception using errcode = '22023', message = 'employee_anonymised';
  end if;

  if p_decision = 'approved' and not v_employee.active then
    raise exception using errcode = '22023', message = 'employee_inactive';
  end if;

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

    if v_request.kind = 'add' and exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_request.proposed -> 'events') as item (value)
      join public.sites as site
        on site.id = (item.value ->> 'site_id')::uuid
      where not site.active
    ) then
      raise exception using errcode = '55000', message = 'site_inactive';
    end if;

    -- Events appended since the request may now share an instant.
    v_problem := private.proposed_times_problem(
      v_request.organization_id, v_request.employee_id, v_request.proposed -> 'events'
    );
    if v_problem is not null then
      raise exception using errcode = '22023', message = v_problem;
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
      'event_count', v_event_count,
      'self_decided', v_self,
      'origin', v_request.origin
    )
  );

  return v_request;
end;
$$;

-- 3. rpc_manager_correct -------------------------------------------------------------------------

create function private.manager_correct(
  p_employee_id uuid,
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
  v_employee public.employees;
  v_membership public.memberships;
  v_target_role text;
  v_parsed record;
  v_request public.correction_requests;
begin
  if v_user_id is null or p_employee_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- The organization comes from the employee row, never from input. Unknown
  -- employees look like foreign ones.
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_membership := private.require_privileged(v_employee.organization_id);

  if not private.can_see_employee(v_employee.id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- Lock order: employee (1003) first; the clock chain (1002) and audit chain
  -- (1001) locks follow through the append triggers. Then the employee row
  -- itself (FOR SHARE, held to commit): offboarding and anonymisation lock it
  -- FOR UPDATE, so neither can slip in between the checks below and the
  -- appended events. No path takes 1003 after an employees row lock.
  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_employee.id::text));

  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id
  for share;

  if not found or v_employee.organization_id <> v_membership.organization_id then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- The self rule of decide_correction: a manager or admin never corrects
  -- their own record; an owner may (single-owner businesses), and the approval
  -- audit row then carries self_decided.
  if v_employee.user_id is not distinct from v_user_id and v_membership.role <> 'owner' then
    raise exception using errcode = '42501', message = 'self_correction_not_allowed';
  end if;

  -- The role rule of rpc_kiosk_set_pin: a manager corrects employees (or
  -- people without a login) only; nobody but an owner corrects an owner. No
  -- role oracle: every refusal is not_authorized.
  if v_employee.user_id is not null then
    select member.role
    into v_target_role
    from public.memberships as member
    where member.organization_id = v_employee.organization_id
      and member.user_id = v_employee.user_id;
  end if;

  if (v_membership.role = 'manager' and coalesce(v_target_role, 'employee') <> 'employee')
    or (v_target_role = 'owner' and v_membership.role <> 'owner')
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if v_employee.anonymised_at is not null then
    raise exception using errcode = '22023', message = 'employee_anonymised';
  end if;

  if not v_employee.active then
    raise exception using errcode = '22023', message = 'employee_inactive';
  end if;

  -- About 60 manager corrections per actor per hour, over all organizations
  -- (not serialised: concurrent calls by one actor may pass a few more).
  if (
    select pg_catalog.count(*)
    from (
      select 1
      from public.correction_requests as recent
      where recent.origin = 'manager'
        and recent.requested_by = v_user_id
        and recent.created_at > v_now - interval '1 hour'
      limit 60
    ) as capped
  ) >= 60 then
    raise exception using errcode = '54000', message = 'correction_rate_limited';
  end if;

  select parsed.*
  into v_parsed
  from private.correction_parse(p_kind, p_target_event_ids, p_proposed, p_reason) as parsed;

  -- Targets and sites must belong to this employee's organization, and the
  -- targets to this employee.
  if v_parsed.o_organization_id <> v_employee.organization_id
    or (p_kind <> 'add' and v_parsed.o_target_employee_id <> v_employee.id)
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.correction_check(
    v_employee.organization_id, v_employee.id, p_kind, v_parsed.o_targets, v_parsed.o_site_ids,
    v_parsed.o_events, v_now
  );

  -- No pending cap: this row is decided before the transaction ends, so it
  -- never counts as pending and the employee's own open requests do not block
  -- the manager.
  insert into public.correction_requests (
    organization_id, employee_id, requested_by, kind, target_event_ids, proposed, reason, origin
  )
  values (
    v_employee.organization_id,
    v_employee.id,
    v_user_id,
    p_kind,
    v_parsed.o_targets,
    pg_catalog.jsonb_build_object('events', v_parsed.o_events),
    v_parsed.o_reason,
    'manager'
  )
  returning * into v_request;

  perform private.write_audit(
    v_employee.organization_id,
    'correction_request.created',
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee.id,
      'kind', p_kind,
      'target_count', cardinality(v_parsed.o_targets),
      'event_count', jsonb_array_length(v_parsed.o_events),
      'origin', 'manager'
    )
  );

  -- The normal approval, in this transaction: it checks the caller again,
  -- re-validates, appends the events and writes their audit rows. If it
  -- raises, the request row above is rolled back with everything else.
  v_request := private.decide_correction(v_request.id, 'approved', null);

  -- Defence in depth: never return (or leave) anything but an approved row.
  if v_request.status is distinct from 'approved' then
    raise exception using errcode = 'P0001', message = 'correction_not_applied';
  end if;

  return v_request;
end;
$$;

-- 4. Public wrapper ------------------------------------------------------------------------------

create function public.rpc_manager_correct(
  p_employee_id uuid,
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
  select * from private.manager_correct(p_employee_id, p_kind, p_target_event_ids, p_proposed, p_reason);
$$;

comment on function public.rpc_manager_correct(uuid, text, uuid[], jsonb, text) is
  'Privileged (fresh MFA, manager-scoped, never own record as manager/admin): record a correction for an employee with a mandatory reason; approved and appended in the same transaction.';

-- 5. Data-subject export: correction rows say who started them ------------------------------------

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
        'offline_reason', request.offline_reason, 'origin', request.origin
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

-- Access -----------------------------------------------------------------------------------------

revoke all on function private.correction_parse(text, uuid[], jsonb, text) from public, anon, authenticated, service_role;
revoke all on function private.correction_check(uuid, uuid, text, uuid[], uuid[], jsonb, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.manager_correct(uuid, text, uuid[], jsonb, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_manager_correct(uuid, text, uuid[], jsonb, text)
  from public, anon, authenticated, service_role;

grant execute on function public.rpc_manager_correct(uuid, text, uuid[], jsonb, text) to authenticated;
