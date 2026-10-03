-- Offline clocking (ADR 006).
--
-- The PWA queues a clock action with its client_captured_at and an idempotency
-- key while there is no connection. On sync, rpc_clock_offline either records
-- it with occurred_at = the captured time (source 'app', offline = true, both
-- times chained so the skew stays visible) or, when it does not fit, turns it
-- into a pending correction request ("Offline geregistreerd") for a manager.
-- Nothing is silently rewritten.
--
-- 1. clock_events.offline. The canonical bytes gain a '|offline' suffix only
--    for offline rows, so every existing hash stays valid.
-- 2. The append trigger keeps occurred_at for offline app events inside
--    [server_at - 72 h, server_at]; every other non-correction event is still
--    forced to server_at.
-- 3. correction_requests.offline (+ idempotency key and cause), so a replay
--    returns the original outcome and the UI can say "offline".
-- 4. settings.offline_clocking (boolean, default on when absent).
-- 5. rpc_clock_offline. Lock order as live clocking: 1003 (employee)
--    -> 1002 (clock chain, via the append trigger) -> 1001 (audit chain).

-- 1. Column and canonical bytes -----------------------------------------------------------

alter table public.clock_events add column offline boolean not null default false;

-- Offline events are app events whose occurred_at is the captured device time.
alter table public.clock_events
  add constraint clock_events_offline_check
    check (not offline or (source = 'app' and client_captured_at is not null and client_captured_at = occurred_at));

comment on column public.clock_events.offline is
  'Queued on the device while offline: occurred_at = client_captured_at, server_at = sync time (ADR 006).';

-- Same 14 fields as before; '|offline' is appended only for offline rows, so
-- the bytes (and hashes) of every non-offline row are unchanged. No field can
-- end in '|offline' by itself (the last field is geo: '' or a jsonb object).
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
  ) || case when p_row.offline then '|offline' else '' end;
$$;

-- 2. Append trigger -------------------------------------------------------------------------

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
  new.hash := private.chain_hash(new.prev_hash, private.clock_event_canonical(new));
  perform private.chain_set_head(new.organization_id, 'clock_events', new.id, new.hash);
  return new;
end;
$$;

-- 3. Offline correction requests ------------------------------------------------------------

alter table public.correction_requests
  add column offline boolean not null default false,
  add column idempotency_key uuid,
  add column offline_reason text;

alter table public.correction_requests
  add constraint correction_requests_offline_check check (
    case
      when offline then kind = 'add'
        and idempotency_key is not null
        and offline_reason in ('outside_window', 'later_event_exists', 'invalid_transition', 'site_not_assigned')
      else idempotency_key is null and offline_reason is null
    end
  );

create unique index correction_requests_idempotency_key
  on public.correction_requests (organization_id, employee_id, idempotency_key)
  where idempotency_key is not null;

comment on column public.correction_requests.offline is
  'Created by rpc_clock_offline for a queued event that did not fit (ADR 006).';
comment on column public.correction_requests.offline_reason is
  'Why the offline event became a request: outside_window, later_event_exists, invalid_transition or site_not_assigned.';

-- Only the decision of a pending request may change, exactly once.
create or replace function private.correction_requests_guard()
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
        new.proposed, new.reason, new.created_at, new.offline, new.idempotency_key, new.offline_reason)
      is distinct from
       (old.id, old.organization_id, old.employee_id, old.requested_by, old.kind, old.target_event_ids,
        old.proposed, old.reason, old.created_at, old.offline, old.idempotency_key, old.offline_reason)
  then
    raise exception using errcode = '55000', message = 'only the decision of a correction request may change';
  end if;

  return new;
end;
$$;

-- 4. Org setting ----------------------------------------------------------------------------

alter table public.organizations
  add constraint organizations_offline_clocking_check check (
    case
      when jsonb_typeof(settings) <> 'object' then false
      when not settings ? 'offline_clocking' then true
      else jsonb_typeof(settings -> 'offline_clocking') = 'boolean'
    end
  );

create function private.offline_clocking_enabled(p_organization_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (
      select (organization.settings -> 'offline_clocking')::boolean
      from public.organizations as organization
      where organization.id = p_organization_id
    ),
    true
  );
$$;

-- 5. rpc_clock_offline ------------------------------------------------------------------------

-- Outcomes (rows, not errors, so the queue can act on each):
--   recorded             appended with occurred_at = captured, offline = true
--   correction_requested a pending 'add' request; o_reason says why
--   rejected             dropped by the client; o_reason says why
-- A replay with the same key returns the original recorded or requested
-- outcome. Bad input and foreign ids raise, like rpc_clock.
create function private.clock_offline(
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
  -- chain lock (1002); five minutes of margin covers that wait.
  v_cause := case
    when v_captured < v_now - interval '72 hours' + interval '5 minutes' then 'outside_window'
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

create function public.rpc_clock_offline(
  p_type text,
  p_idempotency_key uuid,
  p_site_id uuid,
  p_client_captured_at timestamptz
)
returns table (outcome text, event_id uuid, correction_id uuid, reason text)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.clock_offline(p_type, p_idempotency_key, p_site_id, p_client_captured_at);
$$;

comment on function public.rpc_clock_offline(text, uuid, uuid, timestamptz) is
  'Sync one queued offline clock action of the caller: recorded, correction_requested or rejected. Idempotent per key.';

revoke all on function private.offline_clocking_enabled(uuid) from public, anon, authenticated, service_role;
revoke all on function private.clock_offline(text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_clock_offline(text, uuid, uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.rpc_clock_offline(text, uuid, uuid, timestamptz) to authenticated;
