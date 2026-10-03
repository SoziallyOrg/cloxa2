-- Offline clocking hardening (ADR 006, security review).
--
-- 1. settings.offline_max_skew_minutes (1-4320, default 240): an offline event
--    that reaches the server later than that after its captured time becomes
--    a correction request (offline_reason 'offline_skew') instead of being
--    recorded, still within the 72-hour hard cap. Backdating by setting the
--    phone clock back now always needs a manager.
-- 2. correction_requests.offline_reason gains 'offline_skew'.
-- Everything else in rpc_clock_offline is unchanged (same locks, replays and
-- outcomes).

alter table public.organizations
  add constraint organizations_offline_max_skew_check check (
    case
      when jsonb_typeof(settings) <> 'object' then false
      when not settings ? 'offline_max_skew_minutes' then true
      when jsonb_typeof(settings -> 'offline_max_skew_minutes') <> 'number' then false
      else (settings -> 'offline_max_skew_minutes')::numeric between 1 and 4320
        and (settings -> 'offline_max_skew_minutes')::numeric
          = pg_catalog.trunc((settings -> 'offline_max_skew_minutes')::numeric)
    end
  );

create function private.offline_max_skew_minutes(p_organization_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select (organization.settings -> 'offline_max_skew_minutes')::numeric::integer
      from public.organizations as organization
      where organization.id = p_organization_id
    ),
    240
  );
$$;

alter table public.correction_requests drop constraint correction_requests_offline_check;
alter table public.correction_requests
  add constraint correction_requests_offline_check check (
    case
      when offline then kind = 'add'
        and idempotency_key is not null
        and offline_reason in (
          'outside_window', 'offline_skew', 'later_event_exists', 'invalid_transition', 'site_not_assigned'
        )
      else idempotency_key is null and offline_reason is null
    end
  );

comment on column public.correction_requests.offline_reason is
  'Why the offline event became a request: outside_window, offline_skew, later_event_exists, invalid_transition or site_not_assigned.';

create or replace function private.clock_offline(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz
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
      offline
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
      true
    )
    returning * into v_event;

    perform private.write_audit(
      v_organization_id,
      'clock_event.recorded',
      'clock_event',
      v_event.id,
      pg_catalog.jsonb_build_object(
        'employee_id', v_employee_id,
        'site_id', p_site_id,
        'type', p_type,
        'source', 'app',
        'offline', true,
        'skew_seconds', pg_catalog.floor(extract(epoch from (v_event.server_at - v_event.occurred_at)))::bigint
      )
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

revoke all on function private.offline_max_skew_minutes(uuid) from public, anon, authenticated, service_role;
