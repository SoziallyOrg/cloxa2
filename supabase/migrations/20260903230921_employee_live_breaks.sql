-- Live unpaid break facts. Owners can disable guards; this is not tamper-proof storage.
create table public.time_breaks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_membership_id uuid not null,
  worksite_id uuid not null,
  time_entry_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  version integer not null default 1 check (version > 0),
  origin text not null default 'live' check (origin = 'live'),
  created_at timestamptz not null,
  foreign key (organization_id, employee_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  foreign key (organization_id, worksite_id)
    references public.worksites (organization_id, id) on delete restrict,
  foreign key (organization_id, employee_membership_id, worksite_id, time_entry_id)
    references public.time_entries (organization_id, membership_id, worksite_id, id) on delete restrict,
  unique (organization_id, employee_membership_id, id),
  check (isfinite(started_at) and isfinite(created_at) and created_at = started_at
    and (ended_at is null or (isfinite(ended_at) and ended_at > started_at)))
);
create unique index time_breaks_one_open_employee on public.time_breaks (employee_membership_id) where ended_at is null;
create unique index time_breaks_one_open_entry on public.time_breaks (time_entry_id) where ended_at is null;
create index time_breaks_entry_order on public.time_breaks (time_entry_id, started_at, id);
create index time_breaks_organization on public.time_breaks (organization_id);
create index time_breaks_worksite on public.time_breaks (worksite_id);
alter table public.time_breaks enable row level security;
revoke all on public.time_breaks from public, anon, authenticated, service_role;
grant select on public.time_breaks to authenticated;
create policy time_breaks_employee_read on public.time_breaks for select to authenticated
  using (private.can_read_own_time_entry(organization_id, employee_membership_id));
create policy time_breaks_manager_read on public.time_breaks for select to authenticated
  using (organization_id = (select private.manager_review_organization()));

create function private.guard_time_break_history()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare parent public.time_entries%rowtype;
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '55000', message = 'time_break_history_required';
  end if;
  if tg_op = 'INSERT' then
    if new.ended_at is not null or new.version <> 1 then
      raise exception using errcode = '55000', message = 'time_break_live_start_required';
    end if;
  else
    if old.ended_at is not null or new.ended_at is null
      or (to_jsonb(new) - array['ended_at', 'version']) is distinct from
        (to_jsonb(old) - array['ended_at', 'version']) then
      raise exception using errcode = '55000', message = 'time_break_history_required';
    end if;
    new.version := old.version + 1;
  end if;
  -- RPC already holds parent before break. No reverse-order lock in this guard.
  select * into parent from public.time_entries where id = new.time_entry_id;
  if parent.ended_at is not null or new.started_at < parent.started_at
    or exists (select 1 from public.time_breaks b where b.time_entry_id = new.time_entry_id
      and b.id <> new.id and coalesce(b.ended_at, 'infinity'::timestamptz) > new.started_at
      and coalesce(new.ended_at, 'infinity'::timestamptz) > b.started_at) then
    raise exception using errcode = '55000', message = 'break_conflict';
  end if;
  return new;
end;
$$;
create trigger time_break_history before insert or update or delete on public.time_breaks
  for each row execute function private.guard_time_break_history();
create trigger time_break_no_truncate before truncate on public.time_breaks
  for each statement execute function private.guard_time_break_history();
revoke all on function private.guard_time_break_history() from public, anon, authenticated, service_role;

create table private.time_break_operations (
  request_id uuid primary key,
  organization_id uuid not null,
  employee_membership_id uuid not null,
  operation text not null check (operation in ('start_break', 'end_break')),
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  result jsonb not null,
  processed_at timestamptz not null,
  foreign key (organization_id, employee_membership_id)
    references public.memberships (organization_id, id) on delete restrict
);
create index time_break_operations_employee on private.time_break_operations (employee_membership_id);
alter table private.time_break_operations enable row level security;
revoke all on private.time_break_operations from public, anon, authenticated, service_role;
create trigger time_break_operation_immutable before update or delete on private.time_break_operations
  for each row execute function private.guard_correction_operation_immutability();
create trigger time_break_operation_no_truncate before truncate on private.time_break_operations
  for each statement execute function private.guard_correction_operation_immutability();

-- Volatile wall-clock authorization, including JWT expiry, reused after every wait.
create function private.live_employee_membership()
returns uuid language sql volatile security definer set search_path = '' as $$
  select m.id from public.memberships m
  join public.organizations o on o.id = m.organization_id
  join auth.users u on u.id = m.user_id
  join auth.sessions s on s.user_id = u.id
  where current_setting('role', true) = 'authenticated'
    and coalesce(auth.role(), 'authenticated') = 'authenticated'
    and m.user_id = auth.uid() and m.role = 'employee' and m.status = 'active'
    and (select count(*) from public.memberships x where x.user_id = auth.uid() and x.status = 'active') = 1
    and o.lifecycle_status in ('research_pilot', 'paid_beta')
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
    and s.id::text = (auth.jwt() ->> 'session_id')
    and (s.not_after is null or s.not_after > clock_timestamp())
    and (not (auth.jwt() ? 'exp') or case when jsonb_typeof(auth.jwt() -> 'exp') = 'number'
      then (auth.jwt() ->> 'exp')::numeric > extract(epoch from clock_timestamp()) else false end);
$$;
revoke all on function private.live_employee_membership() from public, anon, authenticated, service_role;

create function private.change_live_break(client_request_id uuid, intent text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  employee_id uuid;
  tenant_id uuid;
  site_id uuid;
  site_count bigint;
  fact public.time_entries%rowtype;
  pause public.time_breaks%rowtype;
  prior private.time_break_operations%rowtype;
  operation_hash bytea;
  instant timestamptz;
  outcome text;
  result jsonb;
begin
  if client_request_id is null or intent is null or intent not in ('start_break', 'end_break') then
    raise exception using errcode = '22023', message = 'break_invalid_request';
  end if;
  employee_id := private.live_employee_membership();
  if employee_id is null then
    raise exception using errcode = '42501', message = 'Pauze kan niet worden verwerkt.';
  end if;
  perform u.id from auth.users u join auth.sessions s on s.user_id = u.id
    where u.id = auth.uid() and s.id::text = (auth.jwt() ->> 'session_id') for share of u, s;
  -- UUID serialization precedes employee serialization; no other flow uses 17061.
  perform pg_advisory_xact_lock(17061, hashtext(client_request_id::text));
  perform pg_advisory_xact_lock(17031, hashtext(auth.uid()::text));
  perform m.id from public.memberships m where m.user_id = auth.uid() order by m.id for update;
  select m.organization_id into tenant_id from public.memberships m where m.id = employee_id;
  perform o.id from public.organizations o where o.id = tenant_id for share;
  perform w.id from public.worksites w where w.organization_id = tenant_id order by w.id for share;
  select count(*), (array_agg(w.id order by w.id))[1] into site_count, site_id
    from public.worksites w where w.organization_id = tenant_id;
  if site_count <> 1 or private.live_employee_membership() is distinct from employee_id then
    raise exception using errcode = '42501', message = 'Pauze kan niet worden verwerkt.';
  end if;
  operation_hash := sha256(convert_to(jsonb_build_array(auth.uid(), employee_id, intent)::text, 'UTF8'));
  select * into prior from private.time_break_operations where request_id = client_request_id;
  if found then
    if prior.employee_membership_id <> employee_id or prior.operation <> intent or prior.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'break_request_id_reused';
    end if;
    -- Preserve existing immutable outcomes while supplying the public correlation UUID.
    return prior.result || jsonb_build_object('request_id', client_request_id);
  end if;
  select * into fact from public.time_entries where membership_id = employee_id and ended_at is null for update;
  perform b.id from public.time_breaks b where b.employee_membership_id = employee_id order by b.id for update;
  select * into pause from public.time_breaks where employee_membership_id = employee_id and ended_at is null;
  if private.live_employee_membership() is distinct from employee_id then
    raise exception using errcode = '42501', message = 'Pauze kan niet worden verwerkt.';
  end if;
  instant := clock_timestamp();
  if fact.id is null then outcome := 'no_open_shift';
  elsif intent = 'start_break' and pause.id is not null then outcome := 'already_on_break';
  elsif intent = 'end_break' and (pause.id is null or pause.time_entry_id <> fact.id) then outcome := 'no_open_break';
  elsif intent = 'end_break' and instant <= pause.started_at then outcome := 'invalid_interval';
  elsif intent = 'start_break' and instant < fact.started_at then outcome := 'invalid_interval';
  elsif intent = 'start_break' then
    insert into public.time_breaks (organization_id, employee_membership_id, worksite_id, time_entry_id, started_at, created_at)
      values (tenant_id, employee_id, site_id, fact.id, instant, instant) returning * into pause;
    outcome := 'started';
  else
    update public.time_breaks set ended_at = instant where id = pause.id returning * into pause;
    outcome := 'ended';
  end if;
  result := jsonb_build_object('request_id', client_request_id, 'result_code', outcome, 'did_transition', outcome in ('started', 'ended'),
    'break_id', pause.id, 'time_entry_id', fact.id, 'started_at', pause.started_at,
    'ended_at', pause.ended_at, 'version', pause.version);
  if outcome in ('started', 'ended') then
    insert into public.audit_events (organization_id, actor_user_id, entity_type, entity_id, action, after_data, created_at)
      values (tenant_id, auth.uid(), 'time_break', pause.id, 'time_break.' || outcome,
        jsonb_build_object('break_id', pause.id, 'time_entry_id', fact.id,
          'status', case when pause.ended_at is null then 'open' else 'closed' end,
          'started_at', pause.started_at, 'ended_at', pause.ended_at, 'version', pause.version), instant);
  end if;
  insert into private.time_break_operations values (client_request_id, tenant_id, employee_id, intent, operation_hash, result, instant);
  return result;
end;
$$;
create function public.start_break(request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.change_live_break($1, 'start_break'); $$;
create function public.end_break(request_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$ select private.change_live_break($1, 'end_break'); $$;
revoke all on function private.change_live_break(uuid, text), public.start_break(uuid), public.end_break(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.change_live_break(uuid, text), public.start_break(uuid), public.end_break(uuid) to authenticated;

-- Shared factual read projection. Internal only; callers filter parent ownership.
create function private.time_entry_breaks(entry_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'started_at', b.started_at,
    'ended_at', b.ended_at, 'version', b.version) order by b.started_at, b.id), '[]'::jsonb)
  from public.time_breaks b where b.time_entry_id = entry_id;
$$;
revoke all on function private.time_entry_breaks(uuid) from public, anon, authenticated, service_role;

-- Broaden only creation outcome contracts, never stored export snapshots.
alter table private.time_clock_requests drop constraint time_clock_requests_result_check,
  drop constraint time_clock_requests_transition_check, drop constraint time_clock_requests_snapshot_check;
alter table private.time_clock_requests add constraint time_clock_requests_result_check check (
  (operation = 'clock_in' and result_code in ('started', 'already_working')) or
  (operation = 'clock_out' and result_code in ('stopped', 'already_stopped', 'open_break'))
), add constraint time_clock_requests_transition_check check (
  time_entry_id is not null or result_code = 'already_stopped'
), add constraint time_clock_requests_snapshot_check check (
  (time_entry_id is null and result_code = 'already_stopped' and started_at is null and ended_at is null)
  or (time_entry_id is not null and started_at is not null and (
    (operation = 'clock_in' and ended_at is null) or
    (operation = 'clock_out' and ((result_code = 'open_break' and ended_at is null)
      or (result_code <> 'open_break' and ended_at is not null)))))
);
create trigger time_clock_operation_immutable before update or delete on private.time_clock_requests
  for each row execute function private.guard_correction_operation_immutability();
create trigger time_clock_operation_no_truncate before truncate on private.time_clock_requests
  for each statement execute function private.guard_correction_operation_immutability();
create or replace function private.clock_out(client_request_id uuid)
returns table (
  request_id uuid,
  result_code text,
  did_transition boolean,
  time_entry_id uuid,
  worksite_id uuid,
  started_at timestamptz,
  ended_at timestamptz
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
  current_entry public.time_entries%rowtype;
  prior_request private.time_clock_requests%rowtype;
  operation_time timestamptz;
begin
  if client_request_id is null then
    raise exception using errcode = '22023', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

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
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17031, pg_catalog.hashtext(caller_id::text));
  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for update;

  select pg_catalog.count(*) into active_count
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active';
  if active_count <> 1 then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  select membership.id, membership.organization_id
  into target_membership_id, target_organization_id
  from public.memberships as membership
  where membership.user_id = caller_id
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  if private.live_employee_membership() is distinct from target_membership_id then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;
  select request.* into prior_request
  from private.time_clock_requests as request
  where request.membership_id = target_membership_id
    and request.request_id = client_request_id;
  if found then
    if prior_request.operation <> 'clock_out' then
      raise exception using errcode = '22023', message = 'Tijdregistratie kan niet worden verwerkt.';
    end if;
    return query select prior_request.request_id, prior_request.result_code,
      prior_request.result_code = 'stopped', prior_request.time_entry_id,
      prior_request.worksite_id, prior_request.started_at, prior_request.ended_at;
    return;
  end if;

  select entry.* into current_entry
  from public.time_entries as entry
  where entry.membership_id = target_membership_id and entry.ended_at is null
  for update;
  if not found then
    select entry.* into current_entry
    from public.time_entries as entry
    where entry.membership_id = target_membership_id
    order by entry.started_at desc, entry.id desc
    limit 1;

    operation_time := pg_catalog.clock_timestamp();
    insert into private.time_clock_requests (
      membership_id, request_id, operation, result_code, time_entry_id,
      worksite_id, started_at, ended_at, processed_at
    ) values (
      target_membership_id, client_request_id, 'clock_out', 'already_stopped',
      current_entry.id, coalesce(current_entry.worksite_id, target_worksite_id),
      current_entry.started_at, current_entry.ended_at, operation_time
    );
    return query select client_request_id, 'already_stopped'::text, false,
      current_entry.id, coalesce(current_entry.worksite_id, target_worksite_id),
      current_entry.started_at, current_entry.ended_at;
    return;
  end if;

  perform b.id from public.time_breaks b where b.time_entry_id = current_entry.id order by b.id for update;
  if private.live_employee_membership() is distinct from target_membership_id then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;
  if exists (select 1 from public.time_breaks b where b.time_entry_id = current_entry.id and b.ended_at is null) then
    insert into private.time_clock_requests (membership_id, request_id, operation, result_code,
      time_entry_id, worksite_id, started_at, ended_at, processed_at)
    values (target_membership_id, client_request_id, 'clock_out', 'open_break', current_entry.id,
      current_entry.worksite_id, current_entry.started_at, null, clock_timestamp());
    return query select client_request_id, 'open_break'::text, false, current_entry.id,
      current_entry.worksite_id, current_entry.started_at, null::timestamptz;
    return;
  end if;
  operation_time := pg_catalog.clock_timestamp();
  if operation_time < current_entry.started_at then
    operation_time := current_entry.started_at;
  end if;
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  update public.time_entries
  set ended_at = operation_time
  where id = current_entry.id
  returning * into current_entry;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action,
    before_data, after_data
  ) values (
    target_organization_id, caller_id, 'time_entry', current_entry.id,
    'time_entry.clocked_out', '{"state":"working"}'::jsonb,
    '{"state":"stopped"}'::jsonb
  );

  insert into private.time_clock_requests (
    membership_id, request_id, operation, result_code, time_entry_id,
    worksite_id, started_at, ended_at, processed_at
  ) values (
    target_membership_id, client_request_id, 'clock_out', 'stopped',
    current_entry.id, current_entry.worksite_id, current_entry.started_at,
    current_entry.ended_at, operation_time
  );

  return query select client_request_id, 'stopped'::text, true,
    current_entry.id, current_entry.worksite_id, current_entry.started_at,
    current_entry.ended_at;
end;
$$;
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
  if exists (select 1 from public.time_breaks b where b.time_entry_id = old.id
    and (b.started_at < new.started_at or (new.ended_at is not null
      and (b.ended_at is null or b.ended_at > new.ended_at)))) then
    raise exception using errcode = '55000', message = 'break_conflict';
  end if;
  new.version := old.version + 1;
  return new;
end;
$$;
alter table private.correction_request_operations alter column correction_request_id drop not null;
alter table private.correction_request_operations drop constraint correction_request_operations_result_check;
alter table private.correction_request_operations add constraint correction_request_operations_result_check check (
  (operation in ('submit_adjustment', 'submit_missed_entry') and result_code = 'submitted' and correction_request_id is not null)
  or (operation = 'submit_adjustment' and result_code = 'break_conflict' and correction_request_id is null)
  or (operation = 'withdraw' and result_code in ('withdrawn', 'already_withdrawn') and correction_request_id is not null)
);
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
    if exists (select 1 from public.time_breaks b where b.time_entry_id = target_entry.id
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
alter table private.manager_decision_operations drop constraint manager_decision_operations_result_check;
alter table private.manager_decision_operations add constraint manager_decision_operations_result_check check (
    (result_code = 'approved' and decision = 'approve' and request_status = 'approved' and did_decide and time_entry_id is not null)
    or (result_code = 'rejected' and decision = 'reject' and request_status = 'rejected' and did_decide and time_entry_id is null)
    or (result_code = 'already_decided' and request_status in ('approved', 'rejected', 'withdrawn') and not did_decide and time_entry_id is null)
    or (result_code in ('stale_request', 'overlap', 'invalid_interval', 'unavailable', 'break_conflict') and request_status = 'pending' and not did_decide and time_entry_id is null)
  );
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
      if outcome is null and exists (select 1 from public.time_breaks b
        where b.time_entry_id = target_request.target_time_entry_id and
          (b.ended_at is null or b.started_at < target_request.proposed_started_at
            or b.ended_at > target_request.proposed_ended_at)) then
        outcome := 'break_conflict';
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
create or replace function private.get_employee_time_clock()
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
  server_time timestamptz := pg_catalog.now();
  local_date date;
  day_start timestamptz;
  day_end timestamptz;
  current_started_at timestamptz;
  entries jsonb;
begin
  select context.organization_id, context.membership_role
  into context_organization_id, context_role
  from private.get_auth_context() as context
  where context.authorization_state = 'authorized';
  if not found or context_role <> 'employee' then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden geladen.';
  end if;

  select membership.id into target_membership_id
  from public.memberships as membership
  where membership.organization_id = context_organization_id
    and membership.user_id = (select auth.uid())
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden geladen.';
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = context_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Tijdregistratie kan niet worden geladen.';
  end if;

  local_date := (server_time at time zone 'Europe/Brussels')::date;
  day_start := local_date::timestamp at time zone 'Europe/Brussels';
  day_end := (local_date + 1)::timestamp at time zone 'Europe/Brussels';

  select entry.started_at into current_started_at
  from public.time_entries as entry
  where entry.membership_id = target_membership_id and entry.ended_at is null;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', entry.id,
        'worksite_id', entry.worksite_id,
        'started_at', entry.started_at,
        'ended_at', entry.ended_at,
        'breaks', private.time_entry_breaks(entry.id)
      ) order by entry.started_at, entry.id
    ),
    '[]'::jsonb
  ) into entries
  from public.time_entries as entry
  where entry.membership_id = target_membership_id
    and entry.started_at < day_end
    and (entry.ended_at is null or entry.ended_at > day_start);

  return pg_catalog.jsonb_build_object(
    'status', case when current_started_at is null then 'not_working'
      when exists (select 1 from public.time_breaks b where b.employee_membership_id = target_membership_id and b.ended_at is null) then 'on_break' else 'working' end,
    'current_started_at', current_started_at,
    'server_time', server_time,
    'timezone', 'Europe/Brussels',
    'worksite_id', target_worksite_id,
    'entries', entries
  );
end;
$$;
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
      'ended_at', entry.ended_at,
        'breaks', private.time_entry_breaks(entry.id)
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
      'breaks', private.time_entry_breaks(request.target_time_entry_id),
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
create or replace function private.get_manager_correction_requests()
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
      'breaks', private.time_entry_breaks(request.target_time_entry_id),
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
alter table private.time_export_creation_operations drop constraint time_export_operations_result_check;
alter table private.time_export_creation_operations add constraint time_export_operations_result_check check (
    (result_code = 'created' and export_id is not null)
    or (result_code in (
      'no_records', 'open_entry', 'pending_correction',
      'row_limit', 'artifact_too_large', 'break_data_requires_v2'
    ) and export_id is null)
  );
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

  select coalesce(bool_or(exists (select 1 from public.time_breaks b where b.time_entry_id = entry.id)), false),
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
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  -- One statement snapshot binds names, codes, facts, totals, and blockers, including
  -- memberships first created after employee-lock enumeration. The STABLE row helper
  -- sees this statement snapshot; no second factual read can create a mixed result.
  select coalesce(bool_or(exists (select 1 from public.time_breaks b where b.time_entry_id = entry.id)), false),
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
