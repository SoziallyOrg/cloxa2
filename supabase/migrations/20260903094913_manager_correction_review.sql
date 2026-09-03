-- Manager decisions apply the immutable employee proposal under the employee's
-- existing clock lock. No application role gains direct mutation privileges.
alter table public.correction_requests
  add column manager_note text,
  add column applied_time_entry_id uuid,
  add constraint correction_requests_tenant_employee_worksite_id_key
    unique (organization_id, employee_membership_id, worksite_id, id),
  add constraint correction_requests_applied_entry_fkey foreign key (
    organization_id, employee_membership_id, worksite_id, applied_time_entry_id
  ) references public.time_entries (
    organization_id, membership_id, worksite_id, id
  ) on delete restrict,
  add constraint correction_requests_manager_note_check check (
    manager_note is null or (
      manager_note = pg_catalog.btrim(manager_note, E' \t\n\r\f\v')
      and pg_catalog.char_length(manager_note) between 1 and 500
    )
  ),
  add constraint correction_requests_decision_fields_check check (
    (status in ('pending', 'withdrawn') and manager_note is null and applied_time_entry_id is null)
    or (status = 'rejected' and manager_note is not null and applied_time_entry_id is null)
    or (status = 'approved' and applied_time_entry_id is not null
      and (request_kind = 'missed_entry' or applied_time_entry_id = target_time_entry_id))
  );

create index correction_requests_review_queue_idx
  on public.correction_requests (organization_id, status, created_at, id);
create index correction_requests_applied_entry_idx
  on public.correction_requests (applied_time_entry_id)
  where applied_time_entry_id is not null;

alter table public.time_entries
  add constraint time_entries_tenant_membership_id_key unique (organization_id, membership_id, id),
  add column version integer not null default 1,
  add column origin text not null default 'clock',
  add column last_correction_request_id uuid,
  add constraint time_entries_version_check check (version >= 1),
  add constraint time_entries_origin_check check (origin in ('clock', 'approved_missed_entry')),
  add constraint time_entries_correction_state_check check (
    (last_correction_request_id is null and origin = 'clock')
    or (last_correction_request_id is not null and ended_at is not null)
  ),
  add constraint time_entries_correction_request_fkey foreign key (
    organization_id, membership_id, worksite_id, last_correction_request_id
  ) references public.correction_requests (
    organization_id, employee_membership_id, worksite_id, id
  ) on delete restrict;
create index time_entries_last_correction_request_idx
  on public.time_entries (last_correction_request_id)
  where last_correction_request_id is not null;

create table private.manager_decision_operations (
  request_id uuid primary key,
  organization_id uuid not null,
  manager_membership_id uuid not null,
  employee_membership_id uuid not null,
  correction_request_id uuid not null,
  decision text not null,
  payload_hash bytea not null,
  result_code text not null,
  request_status text not null,
  did_decide boolean not null,
  time_entry_id uuid,
  processed_at timestamptz not null,
  constraint manager_decision_operations_manager_fkey foreign key (organization_id, manager_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint manager_decision_operations_request_fkey foreign key (
    organization_id, employee_membership_id, correction_request_id
  ) references public.correction_requests (organization_id, employee_membership_id, id) on delete restrict,
  constraint manager_decision_operations_entry_fkey foreign key (
    organization_id, employee_membership_id, time_entry_id
  ) references public.time_entries (organization_id, membership_id, id) on delete restrict,
  constraint manager_decision_operations_decision_check check (decision in ('approve', 'reject')),
  constraint manager_decision_operations_hash_check check (pg_catalog.octet_length(payload_hash) = 32),
  constraint manager_decision_operations_result_check check (
    (result_code = 'approved' and decision = 'approve' and request_status = 'approved' and did_decide and time_entry_id is not null)
    or (result_code = 'rejected' and decision = 'reject' and request_status = 'rejected' and did_decide and time_entry_id is null)
    or (result_code = 'already_decided' and request_status in ('approved', 'rejected', 'withdrawn') and not did_decide and time_entry_id is null)
    or (result_code in ('stale_request', 'overlap', 'invalid_interval', 'unavailable') and request_status = 'pending' and not did_decide and time_entry_id is null)
  )
);
create index manager_decision_operations_manager_idx on private.manager_decision_operations (manager_membership_id);
create index manager_decision_operations_request_idx on private.manager_decision_operations (correction_request_id);
create index manager_decision_operations_entry_idx on private.manager_decision_operations (time_entry_id) where time_entry_id is not null;
alter table private.manager_decision_operations enable row level security;
revoke all on private.manager_decision_operations from public, anon, authenticated, service_role;

create trigger manager_decision_operation_immutable before update or delete
  on private.manager_decision_operations for each row
  execute function private.guard_correction_operation_immutability();
create trigger manager_decision_operation_no_truncate before truncate
  on private.manager_decision_operations for each statement
  execute function private.guard_correction_operation_immutability();

create or replace function private.guard_correction_request_immutability()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '55000', message = 'correction_request_immutable';
  end if;
  if old.status <> 'pending' or new.status not in ('withdrawn', 'approved', 'rejected')
    or (pg_catalog.to_jsonb(new) - array[
      'status', 'withdrawal_request_id', 'withdrawn_at', 'resolved_at',
      'resolved_by_membership_id', 'resolution_request_id', 'manager_note', 'applied_time_entry_id'
    ]) is distinct from (pg_catalog.to_jsonb(old) - array[
      'status', 'withdrawal_request_id', 'withdrawn_at', 'resolved_at',
      'resolved_by_membership_id', 'resolution_request_id', 'manager_note', 'applied_time_entry_id'
    ]) then
    raise exception using errcode = '55000', message = 'correction_request_immutable';
  end if;
  return new;
end;
$$;

-- Version every factual update, including a Phase 3 clock-out; retain immutable
-- identity/creation/origin fields and forbid erasure, including owner accidents.
create function private.guard_time_entry_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '55000', message = 'time_entry_history_required';
  end if;
  if (new.id, new.organization_id, new.membership_id, new.worksite_id, new.created_at, new.origin)
    is distinct from (old.id, old.organization_id, old.membership_id, old.worksite_id, old.created_at, old.origin) then
    raise exception using errcode = '55000', message = 'time_entry_history_required';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
create trigger time_entry_history before update or delete on public.time_entries
  for each row execute function private.guard_time_entry_history();
create trigger time_entry_no_truncate before truncate on public.time_entries
  for each statement execute function private.guard_time_entry_history();
revoke all on function private.guard_time_entry_history() from public, anon, authenticated, service_role;

-- Volatile deliberately: authorization/session expiry is checked again after waits.
create function private.manager_review_organization()
returns uuid language sql volatile security definer set search_path = '' as $$
  select membership.organization_id
  from public.memberships as membership
  join public.organizations as organization on organization.id = membership.organization_id
  join auth.users as auth_user on auth_user.id = membership.user_id
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where pg_catalog.current_setting('role', true) = 'authenticated'
    and coalesce(auth.role(), 'authenticated') = 'authenticated'
    and membership.user_id = auth.uid()
    and membership.role = 'manager' and membership.status = 'active'
    and (select pg_catalog.count(*) from public.memberships as active_membership
      where active_membership.user_id = auth.uid() and active_membership.status = 'active') = 1
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
    and auth_user.email_confirmed_at is not null and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (auth_session.not_after is null or auth_session.not_after > pg_catalog.clock_timestamp())
    and (not (auth.jwt() ? 'exp') or case when jsonb_typeof(auth.jwt() -> 'exp') = 'number'
      then (auth.jwt() ->> 'exp')::numeric > extract(epoch from pg_catalog.clock_timestamp()) else false end);
$$;

create policy time_entries_select_active_manager on public.time_entries for select to authenticated
  using (organization_id = (select private.manager_review_organization()));
create policy correction_requests_select_active_manager on public.correction_requests for select to authenticated
  using (organization_id = (select private.manager_review_organization()));

-- Factual reads must share Phase 4's exactly-one-membership employee boundary,
-- including when a correction creates a new factual row.
create or replace function private.can_read_own_time_entry(
  target_organization_id uuid, target_membership_id uuid
)
returns boolean language sql stable security definer set search_path = '' as $$
  select pg_catalog.current_setting('role', true) = 'authenticated'
    and coalesce(auth.role(), 'authenticated') = 'authenticated'
    and private.can_read_own_correction_request($1, $2);
$$;

-- Do not expose manager identity/operation identifiers through employee table reads.
revoke select on public.correction_requests from authenticated;
grant select (
  id, organization_id, employee_membership_id, worksite_id, target_time_entry_id,
  request_kind, proposed_started_at, proposed_ended_at, original_started_at,
  original_ended_at, employee_reason, status, submission_request_id,
  withdrawal_request_id, created_at, withdrawn_at, resolved_at, manager_note, applied_time_entry_id
) on public.correction_requests to authenticated;

create function private.decide_correction_request(
  client_request_id uuid, client_correction_request_id uuid,
  client_decision text, client_manager_note text
)
returns table (
  request_id uuid, correction_request_id uuid, result_code text,
  request_status text, did_decide boolean, time_entry_id uuid
)
language plpgsql security definer set search_path = '' as $$
declare
  caller_id uuid := auth.uid();
  manager_organization_id uuid;
  manager_membership_id uuid;
  employee_user_id uuid;
  target_employee_membership_id uuid;
  sole_worksite_id uuid;
  worksite_count bigint;
  target_request public.correction_requests%rowtype;
  target_entry public.time_entries%rowtype;
  applied_entry public.time_entries%rowtype;
  prior_operation private.manager_decision_operations%rowtype;
  operation_hash bytea;
  normalized_note text;
  operation_time timestamptz;
  outcome text;
  before_entry jsonb;
begin
  if client_request_id is null or client_correction_request_id is null
    or client_decision is null or client_decision not in ('approve', 'reject')
    or client_manager_note is null or pg_catalog.char_length(client_manager_note) > 500 then
    raise exception using errcode = '22023', message = 'decision_invalid_request';
  end if;
  normalized_note := nullif(pg_catalog.btrim(client_manager_note, E' \t\n\r\f\v'), '');
  if client_decision = 'reject' and normalized_note is null then
    raise exception using errcode = '22023', message = 'decision_note_required';
  end if;
  manager_organization_id := private.manager_review_organization();
  if manager_organization_id is null then
    raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.';
  end if;
  -- Lock manager Auth state first, matching existing protected mutation order.
  perform auth_user.id from auth.users as auth_user
    join auth.sessions as auth_session on auth_session.user_id = auth_user.id
    where auth_user.id = caller_id and auth_session.id::text = (auth.jwt() ->> 'session_id')
    for share of auth_user, auth_session;

  -- Discover employee through tenant-filtered immutable references WITHOUT locking
  -- correction rows. All row locks below follow the employee clock advisory lock.
  select membership.user_id, membership.id into employee_user_id, target_employee_membership_id
    from public.correction_requests as request
    join public.memberships as membership on membership.id = request.employee_membership_id
    where request.id = client_correction_request_id and request.organization_id = manager_organization_id;
  if not found then
    raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.';
  end if;
  -- Global operation UUID prevents changing employee/manager/request on a retry.
  perform pg_catalog.pg_advisory_xact_lock(17041, pg_catalog.hashtext(client_request_id::text));
  perform pg_catalog.pg_advisory_xact_lock(17031, pg_catalog.hashtext(employee_user_id::text));
  perform membership.id from public.memberships as membership
    where membership.user_id in (caller_id, employee_user_id)
    order by membership.id for share;
  perform organization.id from public.organizations as organization
    where organization.id = manager_organization_id for share;
  perform worksite.id from public.worksites as worksite
    where worksite.organization_id = manager_organization_id order by worksite.id for share;
  if private.manager_review_organization() is distinct from manager_organization_id then
    raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.';
  end if;
  select membership.id into manager_membership_id from public.memberships as membership
    where membership.user_id = caller_id and membership.status = 'active' and membership.role = 'manager';
  operation_hash := pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.jsonb_build_array(
    caller_id, client_correction_request_id, client_decision, client_manager_note
  )::text, 'UTF8'));
  select operation.* into prior_operation from private.manager_decision_operations as operation
    where operation.request_id = client_request_id;
  if found then
    if prior_operation.manager_membership_id <> manager_membership_id
      or prior_operation.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'decision_request_id_reused';
    end if;
    return query select prior_operation.request_id, prior_operation.correction_request_id,
      prior_operation.result_code, prior_operation.request_status, prior_operation.did_decide,
      prior_operation.time_entry_id;
    return;
  end if;

  perform entry.id from public.time_entries as entry
    where entry.membership_id = target_employee_membership_id order by entry.id for update;
  select request.* into target_request from public.correction_requests as request
    where request.id = client_correction_request_id
      and request.organization_id = manager_organization_id
      and request.employee_membership_id = target_employee_membership_id for update;
  if not found or private.manager_review_organization() is distinct from manager_organization_id then
    raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.';
  end if;
  operation_time := pg_catalog.clock_timestamp();
  outcome := null;
  if target_request.status <> 'pending' then
    outcome := 'already_decided';
  elsif client_decision = 'reject' then
    outcome := 'rejected';
  else
    select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
      into worksite_count, sole_worksite_id from public.worksites as worksite
      where worksite.organization_id = manager_organization_id;
    if worksite_count <> 1 or sole_worksite_id <> target_request.worksite_id
      or not exists (select 1 from public.memberships as membership
        where membership.id = target_employee_membership_id and membership.user_id = employee_user_id
          and membership.organization_id = manager_organization_id
          and membership.role = 'employee' and membership.status = 'active')
      or (select pg_catalog.count(*) from public.memberships as membership
        where membership.user_id = employee_user_id and membership.status = 'active') <> 1 then
      outcome := 'unavailable';
    elsif target_request.proposed_ended_at <= target_request.proposed_started_at
      or not pg_catalog.isfinite(target_request.proposed_started_at)
      or not pg_catalog.isfinite(target_request.proposed_ended_at)
      or target_request.proposed_ended_at >= operation_time then
      outcome := 'invalid_interval';
    else
      if target_request.request_kind = 'adjustment' then
        select entry.* into target_entry from public.time_entries as entry
          where entry.id = target_request.target_time_entry_id
            and entry.organization_id = manager_organization_id
            and entry.membership_id = target_employee_membership_id
            and entry.worksite_id = sole_worksite_id for update;
        if not found or target_entry.ended_at is null
          or target_entry.started_at is distinct from target_request.original_started_at
          or target_entry.ended_at is distinct from target_request.original_ended_at then
          outcome := 'stale_request';
        end if;
      end if;
      if outcome is null and exists (select 1 from public.time_entries as entry
        where entry.membership_id = target_employee_membership_id
          and (target_request.target_time_entry_id is null or entry.id <> target_request.target_time_entry_id)
          and entry.started_at < target_request.proposed_ended_at
          and coalesce(entry.ended_at, 'infinity'::timestamptz) > target_request.proposed_started_at) then
        outcome := 'overlap';
      end if;
      if outcome is null then outcome := 'approved'; end if;
    end if;
  end if;

  if outcome = 'approved' then
    if target_request.request_kind = 'adjustment' then
      before_entry := pg_catalog.jsonb_build_object(
        'started_at', target_entry.started_at, 'ended_at', target_entry.ended_at,
        'version', target_entry.version, 'origin', target_entry.origin,
        'correction_request_id', target_entry.last_correction_request_id
      );
      update public.time_entries set started_at = target_request.proposed_started_at,
        ended_at = target_request.proposed_ended_at, last_correction_request_id = target_request.id
        where id = target_entry.id returning * into applied_entry;
    else
      insert into public.time_entries (organization_id, membership_id, worksite_id,
        started_at, ended_at, created_at, origin, last_correction_request_id)
      values (manager_organization_id, target_employee_membership_id, sole_worksite_id,
        target_request.proposed_started_at, target_request.proposed_ended_at,
        operation_time, 'approved_missed_entry', target_request.id)
      returning * into applied_entry;
    end if;
  end if;
  if outcome in ('approved', 'rejected') then
    update public.correction_requests set status = outcome, resolved_at = operation_time,
      resolved_by_membership_id = manager_membership_id, resolution_request_id = client_request_id,
      manager_note = normalized_note, applied_time_entry_id = applied_entry.id
      where id = target_request.id returning * into target_request;
    insert into public.audit_events (organization_id, actor_user_id, entity_type, entity_id,
      action, before_data, after_data, created_at)
    values (manager_organization_id, caller_id, 'correction_request', target_request.id,
      'correction_request.' || outcome, '{"status":"pending"}'::jsonb,
      pg_catalog.jsonb_build_object('status', outcome), operation_time);
    if outcome = 'approved' then
      insert into public.audit_events (organization_id, actor_user_id, entity_type, entity_id,
        action, before_data, after_data, created_at)
      values (manager_organization_id, caller_id, 'time_entry', applied_entry.id,
        case target_request.request_kind when 'adjustment' then 'time_entry.adjusted' else 'time_entry.missed_entry_added' end,
        before_entry, pg_catalog.jsonb_build_object(
          'started_at', applied_entry.started_at, 'ended_at', applied_entry.ended_at,
          'version', applied_entry.version, 'origin', applied_entry.origin,
          'correction_request_id', target_request.id
        ), operation_time);
    end if;
  end if;
  insert into private.manager_decision_operations (request_id, organization_id,
    manager_membership_id, employee_membership_id, correction_request_id, decision,
    payload_hash, result_code, request_status, did_decide, time_entry_id, processed_at)
  values (client_request_id, manager_organization_id, manager_membership_id,
    target_employee_membership_id, target_request.id, client_decision, operation_hash, outcome,
    target_request.status, outcome in ('approved', 'rejected'), applied_entry.id, operation_time);
  return query select client_request_id, target_request.id, outcome, target_request.status,
    outcome in ('approved', 'rejected'), applied_entry.id;
end;
$$;

create function private.get_manager_correction_requests()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  target_organization_id uuid := private.manager_review_organization();
  requests jsonb;
  pending_count bigint;
begin
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;
  select count(*) into pending_count from public.correction_requests as request
    where request.organization_id = target_organization_id and request.status = 'pending';
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', request.id, 'employee_display_name', profile.display_name,
    'employee_code', membership.employee_code, 'request_kind', request.request_kind,
    'target_time_entry_id', request.target_time_entry_id,
    'original_started_at', request.original_started_at, 'original_ended_at', request.original_ended_at,
    'proposed_started_at', request.proposed_started_at, 'proposed_ended_at', request.proposed_ended_at,
    'employee_reason', request.employee_reason, 'status', request.status,
    'created_at', request.created_at, 'withdrawn_at', request.withdrawn_at,
    'manager_note', request.manager_note, 'resolved_at', request.resolved_at,
    'applied_time_entry_id', request.applied_time_entry_id
  ) order by (request.status = 'pending') desc, request.created_at, request.id), '[]'::jsonb)
  into requests from (
    -- All pending requests, plus 50 latest terminal requests. No hidden pending work.
    select r.* from public.correction_requests as r where r.organization_id = target_organization_id and r.status = 'pending'
    union all
    (select r.* from public.correction_requests as r where r.organization_id = target_organization_id and r.status <> 'pending'
      order by r.created_at desc, r.id desc limit 50)
  ) as request
  join public.memberships as membership on membership.id = request.employee_membership_id
    and membership.organization_id = target_organization_id
  left join public.profiles as profile on profile.user_id = membership.user_id;
  return jsonb_build_object('requests', requests, 'pending_count', pending_count,
    'timezone', 'Europe/Brussels', 'server_time', clock_timestamp());
end;
$$;

create function public.decide_correction_request(
  request_id uuid, correction_request_id uuid, decision text, manager_note text
)
returns table (request_id uuid, correction_request_id uuid, result_code text,
  request_status text, did_decide boolean, time_entry_id uuid)
language sql security invoker set search_path = '' as $$
  select * from private.decide_correction_request($1, $2, $3, $4);
$$;
create function public.get_manager_correction_requests()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_manager_correction_requests();
$$;

revoke all on function private.manager_review_organization() from public, anon, authenticated, service_role;
revoke all on function private.decide_correction_request(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function private.get_manager_correction_requests() from public, anon, authenticated, service_role;
revoke all on function public.decide_correction_request(uuid, uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_manager_correction_requests() from public, anon, authenticated, service_role;
grant execute on function private.manager_review_organization() to authenticated;
grant execute on function private.decide_correction_request(uuid, uuid, text, text) to authenticated;
grant execute on function private.get_manager_correction_requests() to authenticated;
grant execute on function public.decide_correction_request(uuid, uuid, text, text) to authenticated;
grant execute on function public.get_manager_correction_requests() to authenticated;

comment on table public.correction_requests is 'Immutable employee proposals with one terminal withdrawal or manager decision; explanations stay out of audits.';
comment on table public.time_entries is 'Versioned factual registrations from clock RPCs or approved corrections; immutable origin and append-only correction audit history.';
comment on table private.manager_decision_operations is 'Immutable global decision UUID, actor binding, payload hash, and original safe outcome; no free-text payload.';
create or replace function private.get_employee_correction_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context_organization_id uuid;
  context_role text;
  target_membership_id uuid;
  target_worksite_id uuid;
  worksite_count bigint;
  entries jsonb;
  requests jsonb;
begin
  select context.organization_id, context.membership_role
  into context_organization_id, context_role
  from private.get_auth_context() as context
  where context.authorization_state = 'authorized';
  if not found or context_role <> 'employee' then
    raise exception using errcode = '42501', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;

  select membership.id into target_membership_id
  from public.memberships as membership
  where membership.organization_id = context_organization_id
    and membership.user_id = (select auth.uid())
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = context_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', entry.id,
      'worksite_id', entry.worksite_id,
      'started_at', entry.started_at,
      'ended_at', entry.ended_at
    ) order by entry.started_at desc, entry.id desc),
    '[]'::jsonb
  ) into entries
  from (
    select entry.* from public.time_entries as entry
    where entry.organization_id = context_organization_id
      and entry.membership_id = target_membership_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is not null
    order by entry.started_at desc, entry.id desc
    limit 20
  ) as entry;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', request.id,
      'request_kind', request.request_kind,
      'target_time_entry_id', request.target_time_entry_id,
      'proposed_started_at', request.proposed_started_at,
      'proposed_ended_at', request.proposed_ended_at,
      'employee_reason', request.employee_reason,
      'status', request.status,
      'created_at', request.created_at,
      'withdrawn_at', request.withdrawn_at,
      'resolved_at', request.resolved_at,
      'manager_note', request.manager_note,
      'applied_time_entry_id', request.applied_time_entry_id
    ) order by request.created_at desc, request.id desc),
    '[]'::jsonb
  ) into requests
  from (
    select request.* from public.correction_requests as request
    where request.organization_id = context_organization_id
      and request.employee_membership_id = target_membership_id
    order by request.created_at desc, request.id desc
    limit 50
  ) as request;

  return pg_catalog.jsonb_build_object(
    'server_time', pg_catalog.now(),
    'timezone', 'Europe/Brussels',
    'entries', entries,
    'requests', requests
  );
end;
$$;
