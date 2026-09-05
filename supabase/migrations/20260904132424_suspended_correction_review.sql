-- Phase 9 focused repair: resolve existing tenant-bound corrections without
-- reactivating suspended employee access. Public wrappers, signatures, grants,
-- result contracts, replay, lock order, factual guards and audits stay unchanged.
begin;

create or replace function private.decide_correction_request(
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
  perform b.id from public.time_breaks b where b.employee_membership_id = target_employee_membership_id order by b.id for update;
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
          and membership.role = 'employee' and membership.status in ('active', 'suspended')
          -- A suspended historical target grants no employee access. Its old-tenant
          -- request remains reviewable even when the user is active elsewhere.
          and (membership.status = 'suspended' or (
            select pg_catalog.count(*) from public.memberships as active_membership
            where active_membership.user_id = employee_user_id
              and active_membership.status = 'active'
          ) = 1)) then
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
          or target_entry.ended_at is distinct from target_request.original_ended_at
          or target_entry.version is distinct from target_request.original_time_entry_version then
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
      if outcome is null and exists (select 1 from private.effective_time_breaks(target_request.target_time_entry_id) b
        where not b.removed and
          (b.ended_at is null or b.started_at < target_request.proposed_started_at
            or b.ended_at > target_request.proposed_ended_at)) then
        outcome := 'break_conflict';
      end if;
      if outcome is null and exists (select 1 from public.break_correction_requests r where r.time_entry_id = target_request.target_time_entry_id and r.status = 'pending') then outcome := 'break_conflict'; end if;
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

create or replace function private.decide_break_correction(request_id uuid, correction_request_id uuid, decision text, manager_note text, confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare tenant uuid; manager uuid; employee_user uuid; claim public.break_correction_requests%rowtype;
  parent public.time_entries%rowtype; revision public.time_break_revisions%rowtype;
  prior private.break_correction_decision_operations%rowtype; fingerprint bytea; snapshot jsonb; outcome text; result jsonb;
begin
  tenant := private.manager_review_organization();
  if tenant is null then raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.'; end if;
  if request_id is null or correction_request_id is null or decision is null or decision not in ('approve','reject') or confirmed is distinct from true
    or manager_note is null or char_length(manager_note) > 500 or (decision = 'reject' and nullif(btrim(manager_note,E' \t\r\n\f\v'),'') is null) then
    raise exception using errcode = '22023', message = 'break_invalid_decision'; end if;
  perform u.id from auth.users u join auth.sessions s on s.user_id = u.id where u.id = auth.uid() and s.id::text = auth.jwt()->>'session_id' for share of u,s;
  select r.* into claim from public.break_correction_requests r where r.id = correction_request_id and r.organization_id = tenant;
  if not found then raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.'; end if;
  select m.user_id into employee_user from public.memberships m where m.id = claim.employee_membership_id;
  perform pg_advisory_xact_lock(17072,hashtext(request_id::text));
  perform pg_advisory_xact_lock(17031,hashtext(employee_user::text));
  perform m.id from public.memberships m where m.user_id in (auth.uid(),employee_user) order by m.id for share;
  perform o.id from public.organizations o where o.id = tenant for share;
  perform w.id from public.worksites w where w.organization_id = tenant order by w.id for share;
  if private.manager_review_organization() is distinct from tenant then raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.'; end if;
  select m.id into manager from public.memberships m where m.user_id = auth.uid() and m.status = 'active' and m.organization_id = tenant;
  fingerprint := sha256(convert_to(jsonb_build_array(auth.uid(),tenant,correction_request_id,decision,manager_note,confirmed)::text,'UTF8'));
  select * into prior from private.break_correction_decision_operations o where o.request_id = decide_break_correction.request_id;
  if found then
    if prior.actor_membership_id <> manager or prior.payload_hash <> fingerprint then raise exception using errcode = '22023', message = 'break_request_id_reused'; end if;
    return prior.result;
  end if;
  select * into parent from public.time_entries where id = claim.time_entry_id for update;
  select * into claim from public.break_correction_requests where id = claim.id for update;
  select to_jsonb(b) into snapshot from private.effective_time_breaks(parent.id) b where b.logical_break_id = claim.logical_break_id;
  if private.manager_review_organization() is distinct from tenant then raise exception using errcode = '42501', message = 'Beslissing kan niet worden verwerkt.'; end if;
  outcome := case
    when claim.status <> 'pending' then 'already_terminal'
    when decision = 'reject' then 'rejected'
    when (select count(*) from public.worksites where organization_id = tenant) <> 1
      or not exists(select 1 from public.memberships m
        where m.id = claim.employee_membership_id and m.user_id = employee_user
          and m.organization_id = tenant and m.role = 'employee'
          and m.status in ('active', 'suspended')
          -- Preserve active-target ambiguity checks without blocking suspended history.
          and (m.status = 'suspended' or (
            select count(*) from public.memberships active_membership
            where active_membership.user_id = employee_user
              and active_membership.status = 'active'
          ) = 1)) then 'unavailable'
    when parent.version <> claim.parent_version or parent.started_at <> claim.parent_started_at or parent.ended_at is distinct from claim.parent_ended_at
      or snapshot is distinct from claim.original_snapshot then 'stale_request'
    when exists(select 1 from public.correction_requests r where r.target_time_entry_id = parent.id and r.status = 'pending') then 'pending_time_correction'
    when claim.request_kind <> 'removal' and (claim.proposed_started_at < parent.started_at or claim.proposed_ended_at > parent.ended_at) then 'invalid_interval'
    when claim.request_kind <> 'removal' and exists(select 1 from private.effective_time_breaks(parent.id) b where not b.removed and b.logical_break_id <> claim.logical_break_id
      and b.started_at < claim.proposed_ended_at and b.ended_at > claim.proposed_started_at) then 'overlap'
    else 'approved' end;
  if outcome = 'approved' then
    insert into public.time_break_revisions(organization_id,employee_membership_id,worksite_id,time_entry_id,logical_break_id,correction_request_id,
      version,superseded_snapshot,started_at,ended_at,removed,origin)
    values(tenant,claim.employee_membership_id,claim.worksite_id,claim.time_entry_id,claim.logical_break_id,claim.id,
      coalesce((snapshot->>'version')::integer,0)+1,snapshot,claim.proposed_started_at,claim.proposed_ended_at,claim.request_kind = 'removal',coalesce(snapshot->>'origin','approved_missed_break'))
    returning * into revision;
  end if;
  if outcome in ('approved','rejected') then
    update public.break_correction_requests set status = outcome, decided_at = clock_timestamp(), decided_by_membership_id = manager,
      manager_note = nullif(btrim(decide_break_correction.manager_note,E' \t\r\n\f\v'),''), applied_revision_id = revision.id
      where id = claim.id returning * into claim;
    insert into public.audit_events(organization_id,actor_user_id,entity_type,entity_id,action,after_data)
      values(tenant,auth.uid(),'break_correction_request',claim.id,'break_correction_request.'||outcome,jsonb_build_object('status',outcome));
    if outcome = 'approved' then
      insert into public.audit_events(organization_id,actor_user_id,entity_type,entity_id,action,before_data,after_data)
      values(tenant,auth.uid(),'time_break_revision',revision.id,'time_break_revision.'||case claim.request_kind when 'missed_break' then 'added' when 'adjustment' then 'adjusted' else 'removed' end,
        snapshot,jsonb_build_object('logical_break_id',revision.logical_break_id,'time_entry_id',revision.time_entry_id,'version',revision.version,
          'started_at',revision.started_at,'ended_at',revision.ended_at,'removed',revision.removed,'origin',revision.origin));
    end if;
  end if;
  result := jsonb_build_object('request_id',request_id,'result_code',outcome,'did_transition',outcome in ('approved','rejected'),
    'correction_request_id',claim.id,'request_status',claim.status,'applied_revision_id',claim.applied_revision_id);
  insert into private.break_correction_decision_operations(request_id,organization_id,actor_membership_id,payload_hash,result) values(request_id,tenant,manager,fingerprint,result);
  return result;
end;
$$;

commit;
