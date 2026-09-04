-- Phase 8. Lock order: caller Auth/session, operation UUID (17071 request,
-- 17072 decision, 17073 export), employee 17031 (hash/UUID order for exports),
-- memberships, organization, worksite, parent entries, live breaks, requests.
-- Revisions append under the parent lock. Half-open intervals permit touching.
create table public.break_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_membership_id uuid not null,
  worksite_id uuid not null,
  time_entry_id uuid not null,
  logical_break_id uuid not null,
  request_kind text not null check (request_kind in ('missed_break', 'adjustment', 'removal')),
  parent_version integer not null check (parent_version > 0),
  parent_started_at timestamptz not null,
  parent_ended_at timestamptz not null,
  original_snapshot jsonb,
  proposed_started_at timestamptz,
  proposed_ended_at timestamptz,
  employee_reason text not null check (char_length(btrim(employee_reason)) between 1 and 500),
  status text not null default 'pending' check (status in ('pending', 'withdrawn', 'approved', 'rejected')),
  manager_note text check (char_length(manager_note) between 1 and 500),
  decided_by_membership_id uuid,
  applied_revision_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  decided_at timestamptz,
  submission_request_id uuid not null unique,
  unique (organization_id, employee_membership_id, worksite_id, time_entry_id, logical_break_id, id),
  foreign key (organization_id, employee_membership_id, worksite_id, time_entry_id)
    references public.time_entries (organization_id, membership_id, worksite_id, id),
  foreign key (organization_id, decided_by_membership_id) references public.memberships (organization_id, id),
  check (isfinite(parent_started_at) and isfinite(parent_ended_at) and parent_started_at < parent_ended_at),
  check ((request_kind = 'missed_break') = (original_snapshot is null)),
  check ((request_kind = 'removal' and proposed_started_at is null and proposed_ended_at is null)
    or (request_kind <> 'removal' and proposed_started_at is not null and proposed_ended_at is not null
      and isfinite(proposed_started_at) and isfinite(proposed_ended_at)
      and proposed_started_at < proposed_ended_at and proposed_started_at >= parent_started_at
      and proposed_ended_at <= parent_ended_at)),
  check (isfinite(created_at) and (decided_at is null or isfinite(decided_at))),
  check ((status = 'pending' and decided_at is null and decided_by_membership_id is null and manager_note is null and applied_revision_id is null)
    or (status = 'withdrawn' and decided_at is not null and decided_by_membership_id is null and manager_note is null and applied_revision_id is null)
    or (status = 'rejected' and decided_at is not null and decided_by_membership_id is not null and manager_note is not null and applied_revision_id is null)
    or (status = 'approved' and decided_at is not null and decided_by_membership_id is not null and applied_revision_id is not null))
);
create index break_requests_entry on public.break_correction_requests(time_entry_id, status);
create index break_requests_queue on public.break_correction_requests(organization_id, status, created_at);
create unique index break_requests_pending_target on public.break_correction_requests(logical_break_id) where status = 'pending';

create table public.time_break_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_membership_id uuid not null,
  worksite_id uuid not null,
  time_entry_id uuid not null,
  logical_break_id uuid not null,
  correction_request_id uuid not null unique,
  version integer not null check (version > 0),
  superseded_snapshot jsonb,
  started_at timestamptz,
  ended_at timestamptz,
  removed boolean not null,
  origin text not null check (origin in ('live', 'approved_missed_break')),
  created_at timestamptz not null default clock_timestamp() check (isfinite(created_at)),
  unique(logical_break_id, version),
  unique(organization_id, employee_membership_id, worksite_id, time_entry_id, logical_break_id, id),
  foreign key (organization_id, employee_membership_id, worksite_id, time_entry_id, logical_break_id, correction_request_id)
    references public.break_correction_requests (organization_id, employee_membership_id, worksite_id, time_entry_id, logical_break_id, id),
  check ((removed and started_at is null and ended_at is null) or (not removed and started_at is not null
    and ended_at is not null and isfinite(started_at) and isfinite(ended_at) and started_at < ended_at))
);
alter table public.break_correction_requests add foreign key
  (organization_id, employee_membership_id, worksite_id, time_entry_id, logical_break_id, applied_revision_id)
  references public.time_break_revisions (organization_id, employee_membership_id, worksite_id, time_entry_id, logical_break_id, id);
create index break_revisions_entry on public.time_break_revisions(time_entry_id);

-- Sole latest-state resolver, including tombstones for stale checks and history.
create function private.effective_time_breaks(entry_id uuid)
returns table (logical_break_id uuid, version integer, revision_id uuid, started_at timestamptz,
  ended_at timestamptz, removed boolean, origin text)
language sql stable security definer set search_path = '' set timezone = 'UTC' as $$
  select distinct on (s.logical_break_id) s.* from (
    select b.id, b.version, null::uuid, b.started_at, b.ended_at, false, b.origin
    from public.time_breaks b where b.time_entry_id = entry_id
    union all
    select r.logical_break_id, r.version, r.id, r.started_at, r.ended_at, r.removed, r.origin
    from public.time_break_revisions r where r.time_entry_id = entry_id
  ) as s(logical_break_id, version, revision_id, started_at, ended_at, removed, origin)
  order by s.logical_break_id, s.version desc;
$$;
revoke all on function private.effective_time_breaks(uuid) from public, anon, authenticated, service_role;
create or replace function private.time_entry_breaks(entry_id uuid)
returns jsonb language sql stable security definer set search_path = '' set timezone = 'UTC' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.logical_break_id, 'started_at', b.started_at,
    'ended_at', b.ended_at, 'version', b.version) order by b.started_at, b.logical_break_id), '[]'::jsonb)
  from private.effective_time_breaks(entry_id) b where not b.removed;
$$;

create function private.guard_break_request_history() returns trigger
language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then raise exception using errcode = '55000', message = 'break_request_history_required'; end if;
  if old.status <> 'pending' or new.status = 'pending' or
    (to_jsonb(new) - array['status','manager_note','decided_by_membership_id','applied_revision_id','decided_at'])
    is distinct from (to_jsonb(old) - array['status','manager_note','decided_by_membership_id','applied_revision_id','decided_at']) then
    raise exception using errcode = '55000', message = 'break_request_history_required';
  end if;
  return new;
end;
$$;
create function private.guard_break_revision() returns trigger
language plpgsql security invoker set search_path = '' set timezone = 'UTC' as $$
declare claim public.break_correction_requests%rowtype; parent public.time_entries%rowtype; previous jsonb;
begin
  if tg_op <> 'INSERT' then raise exception using errcode = '55000', message = 'break_revision_history_required'; end if;
  select * into parent from public.time_entries where id = new.time_entry_id for update;
  select * into claim from public.break_correction_requests where id = new.correction_request_id;
  select to_jsonb(b) into previous from private.effective_time_breaks(new.time_entry_id) b where b.logical_break_id = new.logical_break_id;
  if claim.status <> 'pending' or parent.version <> claim.parent_version or parent.ended_at is null
    or previous is distinct from claim.original_snapshot or new.superseded_snapshot is distinct from previous
    or new.version <> coalesce((previous ->> 'version')::integer, 0) + 1
    or new.removed <> (claim.request_kind = 'removal')
    or new.origin <> coalesce(previous ->> 'origin', 'approved_missed_break')
    or new.started_at is distinct from claim.proposed_started_at or new.ended_at is distinct from claim.proposed_ended_at
    or coalesce((previous ->> 'removed')::boolean, false)
    or (not new.removed and (new.started_at < parent.started_at or new.ended_at > parent.ended_at
      or exists (select 1 from private.effective_time_breaks(new.time_entry_id) b where not b.removed
        and b.logical_break_id <> new.logical_break_id and b.started_at < new.ended_at and b.ended_at > new.started_at))) then
    raise exception using errcode = '55000', message = 'break_revision_conflict';
  end if;
  return new;
end;
$$;
create trigger break_request_history before update or delete on public.break_correction_requests for each row execute function private.guard_break_request_history();
create trigger break_request_no_truncate before truncate on public.break_correction_requests for each statement execute function private.guard_break_request_history();
create trigger break_revision_history before insert or update or delete on public.time_break_revisions for each row execute function private.guard_break_revision();
create trigger break_revision_no_truncate before truncate on public.time_break_revisions for each statement execute function private.guard_break_revision();

create table private.break_correction_request_operations (
  request_id uuid primary key, organization_id uuid not null, actor_membership_id uuid not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32), result jsonb not null,
  processed_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, actor_membership_id) references public.memberships(organization_id, id)
);
create table private.break_correction_decision_operations (like private.break_correction_request_operations including all);
alter table private.break_correction_decision_operations add foreign key (organization_id, actor_membership_id) references public.memberships(organization_id, id);

do $$ declare t text; begin
  foreach t in array array['break_correction_requests', 'time_break_revisions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy own_read on public.%I for select to authenticated using (private.can_read_own_time_entry(organization_id, employee_membership_id))', t);
    execute format('create policy manager_read on public.%I for select to authenticated using (organization_id = (select private.manager_review_organization()))', t);
  end loop;
  foreach t in array array['break_correction_request_operations', 'break_correction_decision_operations'] loop
    execute format('alter table private.%I enable row level security', t);
    execute format('revoke all on private.%I from public, anon, authenticated, service_role', t);
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.guard_correction_operation_immutability()', t);
    execute format('create trigger no_truncate before truncate on private.%I for each statement execute function private.guard_correction_operation_immutability()', t);
  end loop;
end $$;
revoke all on function private.guard_break_request_history(), private.guard_break_revision() from public, anon, authenticated, service_role;

-- One endpoint per intent family; exact payload hash includes unnormalized claims.
create function private.change_break_correction(request_id uuid, intent text, entry_id uuid,
  target_id uuid, expected_parent_version integer, expected_break_version integer,
  start_local text, start_occurrence text, end_local text, end_occurrence text, reason text)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare employee uuid; tenant uuid; site uuid; parent public.time_entries%rowtype;
  claim public.break_correction_requests%rowtype; snapshot jsonb; proposed_start timestamptz; proposed_end timestamptz;
  prior private.break_correction_request_operations%rowtype; fingerprint bytea; outcome text; result jsonb; logical_id uuid;
begin
  employee := private.live_employee_membership();
  if employee is null then raise exception using errcode = '42501', message = 'Pauzeaanvraag kan niet worden verwerkt.'; end if;
  if request_id is null or intent is null or intent not in ('missed_break','adjustment','removal','withdraw') then
    raise exception using errcode = '22023', message = 'break_invalid_request'; end if;
  perform u.id from auth.users u join auth.sessions s on s.user_id = u.id
    where u.id = auth.uid() and s.id::text = auth.jwt()->>'session_id' for share of u,s;
  perform pg_advisory_xact_lock(17071, hashtext(request_id::text));
  perform pg_advisory_xact_lock(17031, hashtext(auth.uid()::text));
  perform m.id from public.memberships m where m.user_id = auth.uid() order by m.id for update;
  select m.organization_id into tenant from public.memberships m where m.id = employee;
  perform o.id from public.organizations o where o.id = tenant for share;
  perform w.id from public.worksites w where w.organization_id = tenant order by w.id for share;
  select w.id into site from public.worksites w where w.organization_id = tenant;
  if (select count(*) from public.worksites where organization_id = tenant) <> 1
    or private.live_employee_membership() is distinct from employee then
    raise exception using errcode = '42501', message = 'Pauzeaanvraag kan niet worden verwerkt.'; end if;
  fingerprint := sha256(convert_to(jsonb_build_array(auth.uid(),employee,tenant,intent,entry_id,target_id,
    expected_parent_version,expected_break_version,start_local,start_occurrence,end_local,end_occurrence,reason)::text,'UTF8'));
  select * into prior from private.break_correction_request_operations o where o.request_id = change_break_correction.request_id;
  if found then
    if prior.actor_membership_id <> employee or prior.payload_hash <> fingerprint then raise exception using errcode = '22023', message = 'break_request_id_reused'; end if;
    return prior.result;
  end if;
  if intent = 'withdraw' then
    select * into claim from public.break_correction_requests r where r.id = target_id and r.employee_membership_id = employee and r.organization_id = tenant;
    if not found or entry_id is not null or expected_parent_version is not null or expected_break_version is not null
      or start_local is not null or end_local is not null or start_occurrence is not null or end_occurrence is not null or reason is not null then
      raise exception using errcode = '42501', message = 'Pauzeaanvraag kan niet worden verwerkt.'; end if;
    select * into parent from public.time_entries where id = claim.time_entry_id for update;
    select * into claim from public.break_correction_requests where id = target_id for update;
    outcome := case when claim.status = 'pending' then 'withdrawn' else 'already_terminal' end;
  else
    select * into parent from public.time_entries where id = entry_id and organization_id = tenant and membership_id = employee and worksite_id = site for update;
    if not found then raise exception using errcode = '42501', message = 'Pauzeaanvraag kan niet worden verwerkt.'; end if;
    if reason is null or char_length(btrim(reason, E' \t\r\n\f\v')) not between 1 and 500
      or expected_parent_version is null or expected_parent_version < 1
      or ((intent = 'missed_break') <> (target_id is null and expected_break_version is null)) then
      raise exception using errcode = '22023', message = 'break_invalid_request'; end if;
    if intent = 'removal' then
      if start_local is not null or end_local is not null or start_occurrence is not null or end_occurrence is not null then
        raise exception using errcode = '22023', message = 'break_invalid_request'; end if;
    else
      proposed_start := private.resolve_brussels_local(start_local, start_occurrence);
      proposed_end := private.resolve_brussels_local(end_local, end_occurrence);
    end if;
    logical_id := coalesce(target_id, gen_random_uuid());
    select to_jsonb(b) into snapshot from private.effective_time_breaks(parent.id) b where b.logical_break_id = logical_id;
    outcome := case
      when parent.ended_at is null then 'closed_shift_required'
      when parent.version <> expected_parent_version then 'stale_request'
      when intent <> 'missed_break' and (snapshot is null or expected_break_version is null
        or (snapshot->>'version')::integer <> expected_break_version or (snapshot->>'removed')::boolean) then 'stale_request'
      when exists(select 1 from public.correction_requests r where r.target_time_entry_id = parent.id and r.status = 'pending') then 'pending_time_correction'
      when exists(select 1 from public.break_correction_requests r where r.time_entry_id = parent.id and r.status = 'pending') then 'pending_break_correction'
      when intent <> 'removal' and (proposed_start >= proposed_end or proposed_start < parent.started_at or proposed_end > parent.ended_at
        or not isfinite(proposed_start) or not isfinite(proposed_end)) then 'invalid_interval'
      when intent <> 'removal' and exists(select 1 from private.effective_time_breaks(parent.id) b where not b.removed and b.logical_break_id <> logical_id
        and b.started_at < proposed_end and b.ended_at > proposed_start) then 'overlap'
      when intent = 'adjustment' and (snapshot->>'started_at')::timestamptz = proposed_start and (snapshot->>'ended_at')::timestamptz = proposed_end then 'unchanged'
      else 'submitted' end;
  end if;
  if private.live_employee_membership() is distinct from employee then raise exception using errcode = '42501', message = 'Pauzeaanvraag kan niet worden verwerkt.'; end if;
  if outcome = 'submitted' then
    insert into public.break_correction_requests(organization_id,employee_membership_id,worksite_id,time_entry_id,logical_break_id,request_kind,
      parent_version,parent_started_at,parent_ended_at,original_snapshot,proposed_started_at,proposed_ended_at,employee_reason,submission_request_id)
    values(tenant,employee,site,parent.id,logical_id,intent,parent.version,parent.started_at,parent.ended_at,snapshot,proposed_start,proposed_end,btrim(reason,E' \t\r\n\f\v'),request_id)
    returning * into claim;
  elsif outcome = 'withdrawn' then
    update public.break_correction_requests set status = 'withdrawn', decided_at = clock_timestamp() where id = claim.id returning * into claim;
  end if;
  if outcome in ('submitted','withdrawn') then
    insert into public.audit_events(organization_id,actor_user_id,entity_type,entity_id,action,after_data)
    values(tenant,auth.uid(),'break_correction_request',claim.id,'break_correction_request.'||outcome,jsonb_build_object('status',claim.status));
  end if;
  result := jsonb_build_object('request_id',request_id,'result_code',outcome,'did_transition',outcome in ('submitted','withdrawn'),
    'correction_request_id',claim.id,'request_status',claim.status,'applied_revision_id',claim.applied_revision_id);
  insert into private.break_correction_request_operations(request_id,organization_id,actor_membership_id,payload_hash,result)
    values(request_id,tenant,employee,fingerprint,result);
  return result;
end;
$$;

create function private.decide_break_correction(request_id uuid, correction_request_id uuid, decision text, manager_note text, confirmed boolean)
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
      or not exists(select 1 from public.memberships m where m.id = claim.employee_membership_id and m.role = 'employee' and m.status = 'active')
      or (select count(*) from public.memberships m where m.user_id = employee_user and m.status = 'active') <> 1 then 'unavailable'
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

create function public.change_break_correction(request_id uuid, intent text, entry_id uuid, target_id uuid,
  expected_parent_version integer, expected_break_version integer, start_local text, start_occurrence text, end_local text, end_occurrence text, reason text)
returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.change_break_correction($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11); $$;
create function public.decide_break_correction(request_id uuid, correction_request_id uuid, decision text, manager_note text, confirmed boolean)
returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.decide_break_correction($1,$2,$3,$4,$5); $$;
revoke all on function private.change_break_correction(uuid,text,uuid,uuid,integer,integer,text,text,text,text,text),
  public.change_break_correction(uuid,text,uuid,uuid,integer,integer,text,text,text,text,text),
  private.decide_break_correction(uuid,uuid,text,text,boolean), public.decide_break_correction(uuid,uuid,text,text,boolean)
  from public,anon,authenticated,service_role;
grant execute on function private.change_break_correction(uuid,text,uuid,uuid,integer,integer,text,text,text,text,text),
  public.change_break_correction(uuid,text,uuid,uuid,integer,integer,text,text,text,text,text),
  private.decide_break_correction(uuid,uuid,text,text,boolean), public.decide_break_correction(uuid,uuid,text,text,boolean) to authenticated;

create function private.get_break_corrections(request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare employee uuid := private.live_employee_membership(); tenant uuid := private.manager_review_organization(); result jsonb;
begin
  if request_id is null or (employee is null and tenant is null) then raise exception using errcode = '42501', message = 'Pauzeaanvragen kunnen niet worden geladen.'; end if;
  select jsonb_build_object('request_id',request_id,
    'entries',coalesce((select jsonb_agg(to_jsonb(e) || jsonb_build_object('breaks',
      coalesce((select jsonb_agg(to_jsonb(b) order by b.started_at nulls last,b.logical_break_id) from private.effective_time_breaks(e.id) b),'[]'::jsonb)))
      from (select id,organization_id,membership_id,worksite_id,started_at,ended_at,version from public.time_entries
        where ended_at is not null and (membership_id = employee or organization_id = tenant)
        order by started_at desc,id limit 20) e),'[]'::jsonb),
    'requests',coalesce((select jsonb_agg(to_jsonb(r) order by (r.status = 'pending') desc,r.created_at desc,r.id)
      from (select r.id,r.organization_id,r.employee_membership_id,p.display_name as employee_display_name,m.employee_code,r.worksite_id,r.time_entry_id,r.logical_break_id,r.request_kind,
        r.parent_version,r.parent_started_at,r.parent_ended_at,r.original_snapshot,r.proposed_started_at,r.proposed_ended_at,
        r.employee_reason,r.status,r.manager_note,r.applied_revision_id,r.created_at,r.decided_at,
        e.started_at as current_parent_started_at,e.ended_at as current_parent_ended_at,e.version as current_parent_version,
        (select to_jsonb(b) from private.effective_time_breaks(r.time_entry_id) b where b.logical_break_id = r.logical_break_id) as current_snapshot,
        (e.version <> r.parent_version or r.original_snapshot is distinct from
          (select to_jsonb(b) from private.effective_time_breaks(r.time_entry_id) b where b.logical_break_id = r.logical_break_id)) as stale
        from public.break_correction_requests r join public.time_entries e on e.id = r.time_entry_id
        join public.memberships m on m.id = r.employee_membership_id and m.organization_id = r.organization_id
        left join public.profiles p on p.user_id = m.user_id
        where (r.employee_membership_id = employee or r.organization_id = tenant)
        and (r.status = 'pending' or r.id in (select x.id from public.break_correction_requests x
          where (x.employee_membership_id = employee or x.organization_id = tenant) and x.status <> 'pending' order by x.created_at desc,x.id limit 50))) r),'[]'::jsonb)) into result;
  if employee is not null and private.live_employee_membership() is distinct from employee
    or tenant is not null and private.manager_review_organization() is distinct from tenant then
    raise exception using errcode = '42501', message = 'Pauzeaanvragen kunnen niet worden geladen.'; end if;
  return result;
end;
$$;
create function public.get_break_corrections(request_id uuid) returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.get_break_corrections($1); $$;
revoke all on function private.get_break_corrections(uuid),public.get_break_corrections(uuid) from public,anon,authenticated,service_role;
grant execute on function private.get_break_corrections(uuid),public.get_break_corrections(uuid) to authenticated;

-- Additive v2 metadata and complete canonical snapshot. No v1 rows are rewritten.
create table public.time_exports_v2 (
  id uuid primary key,
  organization_id uuid not null,
  worksite_id uuid not null,
  manifest jsonb not null,
  created_at timestamptz not null,
  unique(organization_id,id),
  foreign key(organization_id,worksite_id) references public.worksites(organization_id,id),
  check (manifest->>'schema_version' = 'cloxa.time-export.v2' and manifest->>'export_id' = id::text
    and manifest->>'organization_id' = organization_id::text and manifest->>'worksite_id' = worksite_id::text)
);
create table private.time_export_v2_snapshots (
  export_id uuid primary key, organization_id uuid not null, records jsonb not null,
  foreign key(organization_id,export_id) references public.time_exports_v2(organization_id,id),
  check(jsonb_typeof(records) = 'array' and jsonb_array_length(records) between 1 and 10000)
);
create table private.time_export_v2_operations (like private.break_correction_request_operations including all);
alter table private.time_export_v2_operations add foreign key(organization_id,actor_membership_id) references public.memberships(organization_id,id);
alter table public.time_exports_v2 enable row level security;
revoke all on public.time_exports_v2 from public,anon,authenticated,service_role;
grant select on public.time_exports_v2 to authenticated;
create policy manager_read on public.time_exports_v2 for select to authenticated using(organization_id = (select private.manager_review_organization()));
create trigger immutable before update or delete on public.time_exports_v2 for each row execute function private.guard_correction_operation_immutability();
create trigger no_truncate before truncate on public.time_exports_v2 for each statement execute function private.guard_correction_operation_immutability();
do $$ declare t text; begin
  foreach t in array array['time_export_v2_snapshots','time_export_v2_operations'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',t);
    execute format('create trigger immutable before update or delete on private.%I for each row execute function private.guard_correction_operation_immutability()',t);
    execute format('create trigger no_truncate before truncate on private.%I for each statement execute function private.guard_correction_operation_immutability()',t);
  end loop;
end $$;

create function private.time_export_v2_selection(tenant uuid,site uuid,utc_start timestamptz,utc_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' set timezone = 'UTC' as $$
  with selected as materialized (
    select e.*,m.employee_code,p.display_name,w.name worksite_name,
      (select count(*) from private.effective_time_breaks(e.id) b where not b.removed) break_count
    from public.time_entries e join public.memberships m on m.id = e.membership_id and m.organization_id = tenant
    left join public.profiles p on p.user_id = m.user_id
    join public.worksites w on w.id = e.worksite_id and w.organization_id = tenant
    where e.organization_id = tenant and e.worksite_id = site and e.started_at >= utc_start and e.started_at < utc_end
      and e.ended_at is not null and isfinite(e.started_at) and isfinite(e.ended_at) and e.ended_at > e.started_at
  ), bounds as (
    select count(*) n, count(distinct membership_id) employees,
      coalesce(sum(4096 + break_count * 2048 + 6 * (octet_length(coalesce(employee_code,'')) + octet_length(coalesce(display_name,'')) + octet_length(worksite_name))),0) + 8192 bytes
    from selected
  ), blockers as (
    select coalesce(jsonb_agg(code order by ordinal),'[]'::jsonb) value from (values
      (1,case when exists(select 1 from public.time_entries e where e.organization_id = tenant and e.worksite_id = site and e.ended_at is null and e.started_at < utc_end) then 'open_entry' end),
      (2,case when exists(select 1 from public.correction_requests r where r.organization_id = tenant and r.worksite_id = site and r.status = 'pending'
        and (r.target_time_entry_id in (select id from selected) or (r.proposed_started_at < utc_end and r.proposed_ended_at > utc_start))) then 'pending_correction' end),
      (3,case when exists(select 1 from public.break_correction_requests r where r.organization_id = tenant and r.status = 'pending' and r.time_entry_id in (select id from selected)) then 'pending_break_correction' end),
      (4,case when (select n from bounds) = 0 then 'no_records' end),
      (5,case when (select n from bounds) > 10000 then 'row_limit' end),
      (6,case when (select bytes from bounds) > 10485760 then 'artifact_too_large' end)
    ) v(ordinal,code) where code is not null
  ), records as (
    select case when (select n <= 10000 and bytes <= 10485760 from bounds) then coalesce((
      select jsonb_agg((r.value || jsonb_build_object('gross_duration_microseconds',r.value->>'duration_microseconds',
        'unpaid_break_duration_microseconds',b.duration::text,
        'net_worked_duration_microseconds',((r.value->>'duration_microseconds')::numeric - b.duration)::text,
        'effective_break_count',jsonb_array_length(b.breaks),'breaks',b.breaks)) - 'duration_microseconds' order by (r.value->>'row_ordinal')::integer)
      from jsonb_array_elements(private.selected_time_export_records(tenant,site,utc_start,utc_end)) r
      cross join lateral (
        select coalesce(sum(extract(epoch from (x.ended_at - x.started_at))*1000000),0)::numeric(30,0) duration,
          coalesce(jsonb_agg(jsonb_build_object('logical_break_id',x.logical_break_id,'version',x.version,'revision_id',x.revision_id,
            'started_at_utc',private.format_export_utc(x.started_at),'ended_at_utc',private.format_export_utc(x.ended_at),'origin',x.origin)
            order by x.started_at,x.logical_break_id),'[]'::jsonb) breaks
        from private.effective_time_breaks((r.value->>'source_time_entry_id')::uuid) x where not x.removed
      ) b),'[]'::jsonb) else '[]'::jsonb end value
  ) select jsonb_build_object('records',(select value from records),'blockers',(select value from blockers),
    'record_count',bounds.n,'employee_count',bounds.employees,
    'warnings',to_jsonb(array_remove(array[
      case when exists(select 1 from selected where employee_code is null) then 'missing_employee_code' end,
      case when exists(select 1 from selected where display_name is null) then 'missing_display_name' end],null))) from bounds;
$$;
revoke all on function private.time_export_v2_selection(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;

create function private.time_export_v2(request_id uuid, intent text, period_start_local text, period_end_local text, confirmed boolean, export_id uuid)
returns jsonb language plpgsql security definer set search_path = '' set timezone = 'UTC' as $$
declare tenant uuid := private.manager_review_organization(); manager uuid; site uuid; employee_user uuid;
  start_date date; end_date date; selected jsonb; manifest jsonb; result jsonb; fingerprint bytea;
  prior private.time_export_v2_operations%rowtype; snapshot public.time_exports_v2%rowtype; operation_time timestamptz;
begin
  if tenant is null or request_id is null then raise exception using errcode = '42501', message = 'Export kan niet worden verwerkt.'; end if;
  if intent is null or intent not in ('preview','create','history','snapshot') then raise exception using errcode = '22023', message = 'export_invalid_request'; end if;
  select w.id into site from public.worksites w where w.organization_id = tenant;
  if (select count(*) from public.worksites where organization_id = tenant) <> 1 then raise exception using errcode = '42501', message = 'Export kan niet worden verwerkt.'; end if;
  if intent in ('history','snapshot') then
    if intent = 'history' then
      select jsonb_build_object('request_id',request_id,'exports',coalesce(jsonb_agg(x.manifest order by x.created_at desc,x.id),'[]'::jsonb)) into result
        from (select e.* from public.time_exports_v2 e where e.organization_id = tenant and e.worksite_id = site order by e.created_at desc,e.id limit 20) x;
    else
      select e.* into snapshot from public.time_exports_v2 e where e.id = export_id and e.organization_id = tenant and e.worksite_id = site;
      if not found then raise exception using errcode = '42501', message = 'Export kan niet worden verwerkt.'; end if;
      select jsonb_build_object('request_id',request_id,'manifest',snapshot.manifest,'records',s.records) into result
        from private.time_export_v2_snapshots s where s.export_id = snapshot.id and s.organization_id = tenant;
    end if;
    if private.manager_review_organization() is distinct from tenant then raise exception using errcode = '42501', message = 'Export kan niet worden verwerkt.'; end if;
    return result;
  end if;
  start_date := private.export_local_date(period_start_local); end_date := private.export_local_date(period_end_local);
  if end_date < start_date or end_date - start_date > 30 or end_date > (clock_timestamp() at time zone 'Europe/Brussels')::date then
    raise exception using errcode = '22023', message = 'export_invalid_period'; end if;
  if intent = 'create' then
    if confirmed is distinct from true then raise exception using errcode = '22023', message = 'export_confirmation_required'; end if;
    perform u.id from auth.users u join auth.sessions s on s.user_id = u.id where u.id = auth.uid() and s.id::text = auth.jwt()->>'session_id' for share of u,s;
    perform pg_advisory_xact_lock(17073,hashtext(request_id::text));
    for employee_user in select m.user_id from public.memberships m where m.organization_id = tenant and m.role = 'employee'
      group by m.user_id order by hashtext(m.user_id::text),m.user_id loop
      perform pg_advisory_xact_lock(17031,hashtext(employee_user::text));
    end loop;
    perform m.id from public.memberships m where m.organization_id = tenant order by m.id for share;
    perform o.id from public.organizations o where o.id = tenant for share;
    perform w.id from public.worksites w where w.organization_id = tenant order by w.id for share;
    if private.manager_review_organization() is distinct from tenant or (select count(*) from public.worksites where organization_id = tenant) <> 1 then
      raise exception using errcode = '42501', message = 'Export kan niet worden verwerkt.'; end if;
    select m.id into manager from public.memberships m where m.user_id = auth.uid() and m.status = 'active' and m.organization_id = tenant;
    fingerprint := sha256(convert_to(jsonb_build_array(auth.uid(),tenant,intent,period_start_local,period_end_local,confirmed,export_id)::text,'UTF8'));
    select * into prior from private.time_export_v2_operations o where o.request_id = time_export_v2.request_id;
    if found then
      if prior.actor_membership_id <> manager or prior.payload_hash <> fingerprint then raise exception using errcode = '22023', message = 'export_request_id_reused'; end if;
      return prior.result;
    end if;
    perform e.id from public.time_entries e where e.organization_id = tenant order by e.id for update;
    perform b.id from public.time_breaks b where b.organization_id = tenant order by b.id for share;
    perform r.id from public.correction_requests r where r.organization_id = tenant order by r.id for share;
    perform r.id from public.break_correction_requests r where r.organization_id = tenant order by r.id for share;
  end if;
  -- One STABLE statement snapshot captures bounds, blockers, names, versions and breaks.
  selected := private.time_export_v2_selection(tenant,site,start_date::timestamp at time zone 'Europe/Brussels',(end_date+1)::timestamp at time zone 'Europe/Brussels');
  if private.manager_review_organization() is distinct from tenant then raise exception using errcode = '42501', message = 'Export kan niet worden verwerkt.'; end if;
  if intent = 'preview' then return selected || jsonb_build_object('request_id',request_id,'period_start_local',start_date,'period_end_local',end_date); end if;
  operation_time := clock_timestamp();
  if jsonb_array_length(selected->'blockers') > 0 then
    result := jsonb_build_object('request_id',request_id,'result_code',selected->'blockers'->>0,'did_create',false,'manifest',null);
  else
    snapshot.id := gen_random_uuid();
    select jsonb_build_object('schema_version','cloxa.time-export.v2','export_id',snapshot.id,'organization_id',tenant,'worksite_id',site,
      'timezone','Europe/Brussels','selection_rule','brussels-start-date.v1','period_start_local',start_date,'period_end_local',end_date,
      'created_at_utc',private.format_export_utc(operation_time),'record_count',(selected->>'record_count')::integer,'employee_count',(selected->>'employee_count')::integer,
      'total_gross_duration_microseconds',sum((r->>'gross_duration_microseconds')::numeric)::numeric(30,0)::text,
      'total_unpaid_break_duration_microseconds',sum((r->>'unpaid_break_duration_microseconds')::numeric)::numeric(30,0)::text,
      'total_net_worked_duration_microseconds',sum((r->>'net_worked_duration_microseconds')::numeric)::numeric(30,0)::text) into manifest
      from jsonb_array_elements(selected->'records') r;
    manifest := manifest || jsonb_build_object('dataset_sha256',encode(sha256(convert_to(jsonb_build_object('manifest',manifest,'records',selected->'records')::text,'UTF8')),'hex'));
    insert into public.time_exports_v2 values(snapshot.id,tenant,site,manifest,operation_time);
    insert into private.time_export_v2_snapshots values(snapshot.id,tenant,selected->'records');
    insert into public.audit_events(organization_id,actor_user_id,entity_type,entity_id,action,after_data,created_at)
      values(tenant,auth.uid(),'time_export',snapshot.id,'time_export.created',manifest - array['export_id','organization_id','worksite_id','created_at_utc','timezone'],operation_time);
    result := jsonb_build_object('request_id',request_id,'result_code','created','did_create',true,'manifest',manifest);
  end if;
  insert into private.time_export_v2_operations(request_id,organization_id,actor_membership_id,payload_hash,result,processed_at) values(request_id,tenant,manager,fingerprint,result,operation_time);
  return result;
end;
$$;
create function public.preview_time_export_v2(request_id uuid,period_start_local text,period_end_local text) returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.time_export_v2($1,'preview',$2,$3,false,null); $$;
create function public.create_time_export_v2(request_id uuid,period_start_local text,period_end_local text,confirmed boolean) returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.time_export_v2($1,'create',$2,$3,$4,null); $$;
create function public.get_time_export_v2_snapshot(request_id uuid,export_id uuid) returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.time_export_v2($1,'snapshot',null,null,false,$2); $$;
create function public.get_time_exports_v2(request_id uuid) returns jsonb language sql security invoker set search_path = '' set timezone = 'UTC' as $$ select private.time_export_v2($1,'history',null,null,false,null); $$;
revoke all on function private.time_export_v2(uuid,text,text,text,boolean,uuid),public.preview_time_export_v2(uuid,text,text),public.create_time_export_v2(uuid,text,text,boolean),public.get_time_export_v2_snapshot(uuid,uuid),public.get_time_exports_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function private.time_export_v2(uuid,text,text,text,boolean,uuid),public.preview_time_export_v2(uuid,text,text),public.create_time_export_v2(uuid,text,text,boolean),public.get_time_export_v2_snapshot(uuid,uuid),public.get_time_exports_v2(uuid) to authenticated;

-- Existing contracts retained; effective containment and ever-had-break v1 blocking.
create or replace function private.guard_time_entry_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '55000', message = 'time_entry_history_required';
  end if;
  if (new.id, new.organization_id, new.membership_id, new.worksite_id, new.created_at, new.origin)
    is distinct from (old.id, old.organization_id, old.membership_id, old.worksite_id, old.created_at, old.origin) then
    raise exception using errcode = '55000', message = 'time_entry_history_required';
  end if;
  perform b.id from public.time_breaks b where b.time_entry_id = old.id order by b.id for update;
  if exists (select 1 from private.effective_time_breaks(old.id) b where not b.removed
    and (b.started_at < new.started_at or (new.ended_at is not null
      and (b.ended_at is null or b.ended_at > new.ended_at)))) then
    raise exception using errcode = '55000', message = 'break_conflict';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
create or replace function private.submit_employee_correction_request(
  client_request_id uuid,
  client_request_kind text,
  client_target_time_entry_id uuid,
  client_proposed_start_local text,
  client_proposed_start_occurrence text,
  client_proposed_end_local text,
  client_proposed_end_occurrence text,
  client_employee_reason text
)
returns table (
  request_id uuid,
  correction_request_id uuid,
  result_code text,
  request_status text,
  did_create boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  session_expires_at timestamptz;
  active_count bigint;
  worksite_count bigint;
  target_organization_id uuid;
  target_membership_id uuid;
  target_worksite_id uuid;
  target_entry public.time_entries%rowtype;
  prior_operation private.correction_request_operations%rowtype;
  created_request public.correction_requests%rowtype;
  operation_name text;
  payload_hash bytea;
  normalized_reason text;
  proposed_start timestamptz;
  proposed_end timestamptz;
  operation_time timestamptz;
begin
  if client_request_id is null
    or client_request_kind is null
    or client_request_kind not in ('adjustment', 'missed_entry')
    or client_employee_reason is null then
    raise exception using errcode = '22023', message = 'correction_invalid_request';
  end if;

  if (client_request_kind = 'adjustment') <> (client_target_time_entry_id is not null) then
    raise exception using errcode = '22023', message = 'correction_invalid_target';
  end if;

  normalized_reason := pg_catalog.btrim(client_employee_reason, E' \t\n\r\f\v');
  if pg_catalog.char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'correction_invalid_reason';
  end if;

  begin
    proposed_start := private.resolve_brussels_local(
      client_proposed_start_local, client_proposed_start_occurrence
    );
  exception when sqlstate '22007' or sqlstate '22008' or sqlstate '22023' then
    raise exception using errcode = sqlstate, message = sqlerrm, detail = 'proposed_start_local';
  end;
  begin
    proposed_end := private.resolve_brussels_local(
      client_proposed_end_local, client_proposed_end_occurrence
    );
  exception when sqlstate '22007' or sqlstate '22008' or sqlstate '22023' then
    raise exception using errcode = sqlstate, message = sqlerrm, detail = 'proposed_end_local';
  end;

  if proposed_end <= proposed_start then
    raise exception using errcode = '22023', message = 'correction_invalid_interval';
  end if;

  operation_name := case client_request_kind
    when 'adjustment' then 'submit_adjustment'
    else 'submit_missed_entry'
  end;
  payload_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      operation_name,
      client_target_time_entry_id,
      client_proposed_start_local,
      client_proposed_start_occurrence,
      client_proposed_end_local,
      client_proposed_end_occurrence,
      client_employee_reason
    )::text,
    'UTF8'
  ));

  select auth_session.not_after into session_expires_at
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (auth_session.not_after is null or auth_session.not_after > pg_catalog.clock_timestamp())
  for share of auth_user, auth_session;
  if caller_id is null or not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  -- Same order as clock functions: Auth rows, caller advisory lock, memberships,
  -- organization, worksites, idempotency row, then factual/request rows.
  perform pg_catalog.pg_advisory_xact_lock(17031, pg_catalog.hashtext(caller_id::text));
  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for update;

  select pg_catalog.count(*) into active_count
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active';
  if active_count <> 1 then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  select membership.id, membership.organization_id
  into target_membership_id, target_organization_id
  from public.memberships as membership
  where membership.user_id = caller_id
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  select operation.* into prior_operation
  from private.correction_request_operations as operation
  where operation.employee_membership_id = target_membership_id
    and operation.request_id = client_request_id;
  if found then
    if prior_operation.operation <> operation_name
      or prior_operation.payload_hash <> payload_hash then
      raise exception using errcode = '22023', message = 'correction_request_id_reused';
    end if;
    return query select prior_operation.request_id,
      prior_operation.correction_request_id, prior_operation.result_code,
      case when prior_operation.result_code = 'submitted' then 'pending'::text else null::text end,
      prior_operation.result_code = 'submitted';
    return;
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;
  if proposed_end >= operation_time then
    raise exception using errcode = '22023', message = 'correction_interval_not_past';
  end if;

  -- Advisory serialization matches time clock, then rows are locked before all
  -- ownership, closed-state, overlap, and snapshot checks.
  perform entry.id from public.time_entries as entry
  where entry.membership_id = target_membership_id
  order by entry.id for update;

  if client_request_kind = 'adjustment' then
    select entry.* into target_entry
    from public.time_entries as entry
    where entry.id = client_target_time_entry_id
      and entry.organization_id = target_organization_id
      and entry.membership_id = target_membership_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is not null;
    if not found then
      raise exception using errcode = '22023', message = 'correction_invalid_target';
    end if;
    perform b.id from public.time_breaks b where b.time_entry_id = target_entry.id order by b.id for update;
    if private.live_employee_membership() is distinct from target_membership_id then
      raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
    end if;
    if exists (select 1 from public.break_correction_requests r where r.time_entry_id = target_entry.id and r.status = 'pending') then
      raise exception using errcode = '22023', message = 'correction_pending_conflict';
    end if;
    if exists (select 1 from private.effective_time_breaks(target_entry.id) b where not b.removed
      and (b.ended_at is null or b.started_at < proposed_start or b.ended_at > proposed_end)) then
      insert into private.correction_request_operations (organization_id, employee_membership_id,
        request_id, operation, payload_hash, correction_request_id, result_code, processed_at)
      values (target_organization_id, target_membership_id, client_request_id, operation_name,
        payload_hash, null, 'break_conflict', clock_timestamp());
      return query select client_request_id, null::uuid, 'break_conflict'::text, null::text, false;
      return;
    end if;
    if proposed_start = target_entry.started_at and proposed_end = target_entry.ended_at then
      raise exception using errcode = '22023', message = 'correction_unchanged';
    end if;
  else
    target_entry := null;
  end if;

  if exists (
    select 1 from public.time_entries as entry
    where entry.membership_id = target_membership_id
      and (client_target_time_entry_id is null or entry.id <> client_target_time_entry_id)
      and entry.started_at < proposed_end
      and coalesce(entry.ended_at, 'infinity'::timestamptz) > proposed_start
  ) then
    raise exception using errcode = '22023', message = 'correction_factual_overlap';
  end if;

  perform request.id from public.correction_requests as request
  where request.employee_membership_id = target_membership_id
  order by request.id for update;
  if exists (
    select 1 from public.correction_requests as request
    where request.employee_membership_id = target_membership_id
      and request.status = 'pending'
      and (
        request.target_time_entry_id = client_target_time_entry_id
        or (request.proposed_started_at < proposed_end
          and request.proposed_ended_at > proposed_start)
      )
  ) then
    raise exception using errcode = '22023', message = 'correction_pending_conflict';
  end if;

  if private.live_employee_membership() is distinct from target_membership_id then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;
  insert into public.correction_requests (
    organization_id, employee_membership_id, worksite_id,
    target_time_entry_id, request_kind, proposed_started_at,
    proposed_ended_at, original_started_at, original_ended_at,
    original_time_entry_version, employee_reason, submission_request_id, created_at
  ) values (
    target_organization_id, target_membership_id, target_worksite_id,
    client_target_time_entry_id, client_request_kind, proposed_start,
    proposed_end, target_entry.started_at, target_entry.ended_at,
    target_entry.version, normalized_reason, client_request_id, operation_time
  ) returning * into created_request;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action, after_data
  ) values (
    target_organization_id, caller_id, 'correction_request', created_request.id,
    'correction_request.submitted', '{"status":"pending"}'::jsonb
  );

  insert into private.correction_request_operations (
    organization_id, employee_membership_id, request_id, operation,
    payload_hash, correction_request_id, result_code, processed_at
  ) values (
    target_organization_id, target_membership_id, client_request_id,
    operation_name, payload_hash, created_request.id, 'submitted', operation_time
  );

  return query select client_request_id, created_request.id, 'submitted'::text,
    'pending'::text, true;
end;
$$;
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
create or replace function private.preview_time_export(
  period_start_local text,
  period_end_local text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := private.manager_review_organization();
  target_worksite_id uuid;
  worksite_count bigint;
  start_date date := private.export_local_date(period_start_local);
  end_date date := private.export_local_date(period_end_local);
  utc_start timestamptz;
  utc_end timestamptz;
  local_today date := (pg_catalog.clock_timestamp() at time zone 'Europe/Brussels')::date;
  records bigint;
  employees bigint;
  duration numeric(30, 0);
  estimated_artifact_bytes numeric;
  missing_codes bigint;
  missing_names bigint;
  has_open boolean;
  has_pending boolean;
  has_breaks boolean;
  blockers jsonb;
  warnings jsonb;
begin
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Exportvoorbeeld kan niet worden geladen.';
  end if;
  if end_date < start_date or end_date - start_date > 30 or end_date > local_today then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end if;
  utc_start := start_date::timestamp at time zone 'Europe/Brussels';
  utc_end := (end_date + 1)::timestamp at time zone 'Europe/Brussels';
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
    into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Exportvoorbeeld kan niet worden geladen.';
  end if;

  select coalesce(bool_or((exists (select 1 from public.time_breaks b where b.time_entry_id = entry.id) or exists (select 1 from public.time_break_revisions b where b.time_entry_id = entry.id))), false),
    pg_catalog.count(*), pg_catalog.count(distinct entry.membership_id),
    coalesce(pg_catalog.sum(
      extract(epoch from (entry.ended_at - entry.started_at)) * 1000000
    ), 0),
    pg_catalog.count(*) filter (where membership.employee_code is null),
    pg_catalog.count(*) filter (where profile.display_name is null),
    coalesce(pg_catalog.sum(
      2048 + 6 * (
        pg_catalog.octet_length(coalesce(membership.employee_code, ''))
        + pg_catalog.octet_length(coalesce(profile.display_name, ''))
        + pg_catalog.octet_length(worksite.name)
      )
    ), 0)
  into has_breaks, records, employees, duration, missing_codes, missing_names,
    estimated_artifact_bytes
  from public.time_entries as entry
  join public.memberships as membership on membership.id = entry.membership_id
    and membership.organization_id = target_organization_id
  left join public.profiles as profile on profile.user_id = membership.user_id
  join public.worksites as worksite on worksite.id = entry.worksite_id
    and worksite.organization_id = target_organization_id
  where entry.organization_id = target_organization_id
    and entry.worksite_id = target_worksite_id
    and entry.ended_at is not null
    and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
    and entry.ended_at > entry.started_at
    and entry.started_at >= utc_start and entry.started_at < utc_end;

  select exists (
    select 1 from public.time_entries as entry
    where entry.organization_id = target_organization_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is null and entry.started_at < utc_end
  ) into has_open;
  select exists (
    select 1 from public.correction_requests as request
    where request.organization_id = target_organization_id
      and request.worksite_id = target_worksite_id and request.status = 'pending'
      and (
        (request.target_time_entry_id is not null and exists (
          select 1 from public.time_entries as entry
          where entry.id = request.target_time_entry_id
            and entry.organization_id = target_organization_id
            and entry.worksite_id = target_worksite_id
            and entry.ended_at is not null
            and entry.ended_at > entry.started_at
            and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
            and entry.started_at >= utc_start and entry.started_at < utc_end
        ))
        or (request.proposed_started_at < utc_end and request.proposed_ended_at > utc_start)
      )
  ) or exists (
    select 1
    from public.break_correction_requests as request
    join public.time_entries as entry on entry.id = request.time_entry_id
      and entry.organization_id = request.organization_id
      and entry.membership_id = request.employee_membership_id
      and entry.worksite_id = request.worksite_id
    where request.organization_id = target_organization_id
      and request.worksite_id = target_worksite_id
      and request.status = 'pending'
      and entry.ended_at is not null
      and entry.ended_at > entry.started_at
      and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
      and entry.started_at >= utc_start and entry.started_at < utc_end
  ) into has_pending;

  select coalesce(pg_catalog.jsonb_agg(code order by ordinal), '[]'::jsonb)
  into blockers
  from (values
    (0, case when has_breaks then 'break_data_requires_v2' end),
    (1, case when records = 0 then 'no_records' end),
    (2, case when has_open then 'open_entry' end),
    (3, case when has_pending then 'pending_correction' end),
    (4, case when records > 10000 then 'row_limit' end),
    (5, case when estimated_artifact_bytes + 8192 > 10485760
      then 'artifact_too_large' end)
  ) as values_list(ordinal, code)
  where code is not null;
  select coalesce(pg_catalog.jsonb_agg(code order by ordinal), '[]'::jsonb)
  into warnings
  from (values
    (1, case when missing_codes > 0 then 'missing_employee_code' end),
    (2, case when missing_names > 0 then 'missing_display_name' end)
  ) as values_list(ordinal, code)
  where code is not null;

  return pg_catalog.jsonb_build_object(
    'timezone', 'Europe/Brussels',
    'period_start_local', start_date,
    'period_end_local', end_date,
    'utc_start_inclusive', private.format_export_utc(utc_start),
    'utc_end_exclusive', private.format_export_utc(utc_end),
    'record_count', records,
    'employee_count', employees,
    'total_duration_microseconds', duration::text,
    'blockers', blockers,
    'warnings', warnings,
    'records', case when records <= 10000 and estimated_artifact_bytes + 8192 <= 10485760
      then coalesce(private.selected_time_export_records(
        target_organization_id, target_worksite_id, utc_start, utc_end
      ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;
create or replace function private.create_time_export(
  request_id uuid,
  period_start_local text,
  period_end_local text,
  confirmed boolean
)
returns table (result_code text, did_create boolean, export_id uuid, manifest jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_organization_id uuid := private.manager_review_organization();
  target_worksite_id uuid;
  manager_membership_id uuid;
  worksite_count bigint;
  start_date date := private.export_local_date(period_start_local);
  end_date date := private.export_local_date(period_end_local);
  local_today date := (pg_catalog.clock_timestamp() at time zone 'Europe/Brussels')::date;
  utc_start timestamptz;
  utc_end timestamptz;
  operation_hash bytea;
  prior_operation private.time_export_creation_operations%rowtype;
  created_export public.time_exports%rowtype;
  operation_time timestamptz;
  employee_user_id uuid;
  records integer;
  employees integer;
  total_duration numeric(30, 0);
  estimated_artifact_bytes numeric;
  has_open boolean;
  has_pending boolean;
  has_breaks boolean;
  outcome text;
  canonical_rows jsonb;
  canonical_input jsonb;
  dataset_hash text;
begin
  if request_id is null or confirmed is distinct from true
    or target_organization_id is null then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;
  if end_date < start_date or end_date - start_date > 30 or end_date > local_today then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end if;
  utc_start := start_date::timestamp at time zone 'Europe/Brussels';
  utc_end := (end_date + 1)::timestamp at time zone 'Europe/Brussels';

  -- Keep Auth rows locked throughout the protected mutation.
  perform auth_user.id from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
  for share of auth_user, auth_session;
  if not found then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  -- Global operation UUID first. Every employee uses the existing 17031 clock and
  -- correction namespace, ordered by lock key then UUID to avoid multi-row deadlocks.
  perform pg_catalog.pg_advisory_xact_lock(17051, pg_catalog.hashtext(request_id::text));
  for employee_user_id in
    select membership.user_id
    from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.role = 'employee'
    group by membership.user_id
    order by pg_catalog.hashtext(membership.user_id::text), membership.user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      17031, pg_catalog.hashtext(employee_user_id::text)
    );
  end loop;
  perform membership.id from public.memberships as membership
  where membership.organization_id = target_organization_id
  order by membership.id for share;
  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id for share;
  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;

  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;
  select membership.id into manager_membership_id
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = caller_id
    and membership.role = 'manager' and membership.status = 'active';
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if manager_membership_id is null or worksite_count <> 1 then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  operation_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      caller_id, period_start_local, period_end_local, confirmed
    )::text, 'UTF8'
  ));
  select operation.* into prior_operation
  from private.time_export_creation_operations as operation
  where operation.request_id = create_time_export.request_id;
  if found then
    if prior_operation.manager_membership_id <> manager_membership_id
      or prior_operation.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'export_request_id_reused';
    end if;
    if prior_operation.export_id is not null then
      select export.* into created_export from public.time_exports as export
      where export.id = prior_operation.export_id
        and export.organization_id = target_organization_id;
      return query select prior_operation.result_code, true, created_export.id,
        private.time_export_manifest(created_export);
    else
      return query select prior_operation.result_code, false, null::uuid, null::jsonb;
    end if;
    return;
  end if;

  perform entry.id from public.time_entries as entry
  where entry.organization_id = target_organization_id
    and entry.worksite_id = target_worksite_id
  order by entry.id for update;
  perform b.id from public.time_breaks b where b.organization_id = target_organization_id order by b.id for share;
  perform correction.id from public.correction_requests as correction
  where correction.organization_id = target_organization_id
    and correction.worksite_id = target_worksite_id
  order by correction.id for share;
  perform request.id from public.break_correction_requests as request
  where request.organization_id = target_organization_id
    and request.worksite_id = target_worksite_id
  order by request.id for share;
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  -- One statement snapshot binds names, codes, facts, totals, and blockers, including
  -- memberships first created after employee-lock enumeration. The STABLE row helper
  -- sees this statement snapshot; no second factual read can create a mixed result.
  select coalesce(bool_or((exists (select 1 from public.time_breaks b where b.time_entry_id = entry.id) or exists (select 1 from public.time_break_revisions b where b.time_entry_id = entry.id))), false),
    pg_catalog.count(*), pg_catalog.count(distinct entry.membership_id),
    coalesce(pg_catalog.sum(
      extract(epoch from (entry.ended_at - entry.started_at)) * 1000000
    ), 0),
    coalesce(pg_catalog.sum(
      2048 + 6 * (
        pg_catalog.octet_length(coalesce(membership.employee_code, ''))
        + pg_catalog.octet_length(coalesce(profile.display_name, ''))
        + pg_catalog.octet_length(worksite.name)
      )
    ), 0),
    exists (
    select 1 from public.time_entries as entry
    where entry.organization_id = target_organization_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is null and entry.started_at < utc_end
   ),
    exists (
      select 1 from public.correction_requests as request
      where request.organization_id = target_organization_id
        and request.worksite_id = target_worksite_id and request.status = 'pending'
        and (
          (request.target_time_entry_id is not null and exists (
            select 1 from public.time_entries as entry
            where entry.id = request.target_time_entry_id
              and entry.organization_id = target_organization_id
              and entry.worksite_id = target_worksite_id
              and entry.ended_at is not null
              and entry.ended_at > entry.started_at
              and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
              and entry.started_at >= utc_start and entry.started_at < utc_end
          ))
          or (request.proposed_started_at < utc_end and request.proposed_ended_at > utc_start)
        )
    ) or exists (
      select 1
      from public.break_correction_requests as request
      join public.time_entries as selected_entry on selected_entry.id = request.time_entry_id
        and selected_entry.organization_id = request.organization_id
        and selected_entry.membership_id = request.employee_membership_id
        and selected_entry.worksite_id = request.worksite_id
      where request.organization_id = target_organization_id
        and request.worksite_id = target_worksite_id
        and request.status = 'pending'
        and selected_entry.ended_at is not null
        and selected_entry.ended_at > selected_entry.started_at
        and pg_catalog.isfinite(selected_entry.started_at)
        and pg_catalog.isfinite(selected_entry.ended_at)
        and selected_entry.started_at >= utc_start
        and selected_entry.started_at < utc_end
    ),
    case when pg_catalog.count(*) <= 10000 and coalesce(pg_catalog.sum(
      2048 + 6 * (
        pg_catalog.octet_length(coalesce(membership.employee_code, ''))
        + pg_catalog.octet_length(coalesce(profile.display_name, ''))
        + pg_catalog.octet_length(worksite.name)
      )
    ), 0) + 8192 <= 10485760
      then private.selected_time_export_records(
        target_organization_id, target_worksite_id, utc_start, utc_end
      ) else '[]'::jsonb end
  into has_breaks, records, employees, total_duration, estimated_artifact_bytes,
    has_open, has_pending, canonical_rows
  from public.time_entries as entry
  join public.memberships as membership on membership.id = entry.membership_id
    and membership.organization_id = target_organization_id
  left join public.profiles as profile on profile.user_id = membership.user_id
  join public.worksites as worksite on worksite.id = entry.worksite_id
    and worksite.organization_id = target_organization_id
  where entry.organization_id = target_organization_id
    and entry.worksite_id = target_worksite_id
    and entry.ended_at is not null
    and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
    and entry.ended_at > entry.started_at
    and entry.started_at >= utc_start and entry.started_at < utc_end;
  outcome := case
    when has_breaks then 'break_data_requires_v2'
    when has_open then 'open_entry'
    when has_pending then 'pending_correction'
    when records = 0 then 'no_records'
    when records > 10000 then 'row_limit'
    when estimated_artifact_bytes + 8192 > 10485760 then 'artifact_too_large'
    else 'created'
  end;
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;
  operation_time := pg_catalog.clock_timestamp();
  if outcome <> 'created' then
    insert into private.time_export_creation_operations (
      request_id, organization_id, manager_membership_id, payload_hash,
      result_code, export_id, processed_at
    ) values (
      create_time_export.request_id, target_organization_id, manager_membership_id,
      operation_hash, outcome, null, operation_time
    );
    return query select outcome, false, null::uuid, null::jsonb;
    return;
  end if;

  created_export.id := pg_catalog.gen_random_uuid();
  created_export.organization_id := target_organization_id;
  created_export.worksite_id := target_worksite_id;
  created_export.schema_version := 'cloxa.time-export.v1';
  created_export.selection_rule := 'brussels-start-date.v1';
  created_export.timezone := 'Europe/Brussels';
  created_export.period_start_local := start_date;
  created_export.period_end_local := end_date;
  created_export.created_at := operation_time;
  created_export.record_count := records;
  created_export.employee_count := employees;
  created_export.total_duration_microseconds := total_duration;

  canonical_input := pg_catalog.jsonb_build_object(
    'manifest', pg_catalog.jsonb_build_object(
      'schema_version', created_export.schema_version,
      'export_id', created_export.id,
      'organization_id', created_export.organization_id,
      'worksite_id', created_export.worksite_id,
      'timezone', created_export.timezone,
      'period_start_local', created_export.period_start_local,
      'period_end_local', created_export.period_end_local,
      'created_at_utc', private.format_export_utc(created_export.created_at),
      'record_count', created_export.record_count,
      'employee_count', created_export.employee_count,
      'total_duration_microseconds', created_export.total_duration_microseconds::text,
      'selection_rule', created_export.selection_rule
    ),
    'records', canonical_rows
  );
  dataset_hash := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(canonical_input::text, 'UTF8')
  ), 'hex');
  created_export.dataset_sha256 := dataset_hash;

  insert into public.time_exports select (created_export).*;
  insert into private.time_export_rows (
    export_id, organization_id, row_ordinal, source_time_entry_id,
    source_time_entry_version, employee_code, employee_display_name,
    worksite_id, worksite_name, started_at_utc, ended_at_utc,
    started_at_brussels, ended_at_brussels, duration_microseconds,
    factual_origin, last_correction_request_id
  )
  select created_export.id, target_organization_id,
    (record ->> 'row_ordinal')::integer,
    (record ->> 'source_time_entry_id')::uuid,
    (record ->> 'source_time_entry_version')::integer,
    record ->> 'employee_code', record ->> 'employee_display_name',
    (record ->> 'worksite_id')::uuid, record ->> 'worksite_name',
    record ->> 'started_at_utc', record ->> 'ended_at_utc',
    record ->> 'started_at_brussels', record ->> 'ended_at_brussels',
    (record ->> 'duration_microseconds')::numeric(30, 0),
    record ->> 'factual_origin',
    (record ->> 'last_correction_request_id')::uuid
  from pg_catalog.jsonb_array_elements(canonical_rows) as record;
  if (select pg_catalog.count(*) from private.time_export_rows as row
      where row.export_id = created_export.id) <> records then
    raise exception using errcode = '55000', message = 'export_snapshot_incomplete';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action,
    after_data, created_at
  ) values (
    target_organization_id, caller_id, 'time_export', created_export.id,
    'time_export.created',
    pg_catalog.jsonb_build_object(
      'schema_version', created_export.schema_version,
      'period_start_local', created_export.period_start_local,
      'period_end_local', created_export.period_end_local,
      'record_count', created_export.record_count,
      'employee_count', created_export.employee_count,
      'total_duration_microseconds', created_export.total_duration_microseconds::text,
      'dataset_sha256', created_export.dataset_sha256,
      'selection_rule', created_export.selection_rule
    ), operation_time
  );
  insert into private.time_export_creation_operations (
    request_id, organization_id, manager_membership_id, payload_hash,
    result_code, export_id, processed_at
  ) values (
    create_time_export.request_id, target_organization_id, manager_membership_id,
    operation_hash, 'created', created_export.id, operation_time
  );
  return query select 'created'::text, true, created_export.id,
    private.time_export_manifest(created_export);
end;
$$;
