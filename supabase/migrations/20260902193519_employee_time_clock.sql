-- Employee time-clock mutations expose only a client request UUID. Privileged
-- implementations derive identity, tenant, membership, worksite, and time from
-- locked database state and append audits in the same transaction.
alter table public.memberships
  add constraint memberships_organization_id_id_key unique (organization_id, id);

alter table public.worksites
  add constraint worksites_organization_id_id_key unique (organization_id, id);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  worksite_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  constraint time_entries_membership_tenant_fkey
    foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint time_entries_worksite_tenant_fkey
    foreign key (organization_id, worksite_id)
    references public.worksites (organization_id, id) on delete restrict,
  constraint time_entries_chronology_check
    check (ended_at is null or ended_at >= started_at)
);

comment on table public.time_entries is
  'Factual employee clock registrations. Writes are limited to controlled clock RPCs.';

create unique index time_entries_one_open_per_membership_key
  on public.time_entries (membership_id)
  where ended_at is null;

create index time_entries_membership_started_at_idx
  on public.time_entries (membership_id, started_at desc);

create index time_entries_organization_id_idx
  on public.time_entries (organization_id);

create index time_entries_worksite_id_idx
  on public.time_entries (worksite_id);

create table private.time_clock_requests (
  membership_id uuid not null references public.memberships (id) on delete restrict,
  request_id uuid not null,
  operation text not null,
  result_code text not null,
  time_entry_id uuid references public.time_entries (id) on delete restrict,
  worksite_id uuid not null references public.worksites (id) on delete restrict,
  started_at timestamptz,
  ended_at timestamptz,
  processed_at timestamptz not null,
  primary key (membership_id, request_id),
  constraint time_clock_requests_operation_check
    check (operation in ('clock_in', 'clock_out')),
  constraint time_clock_requests_result_check check (
    (operation = 'clock_in' and result_code in ('started', 'already_working'))
    or (operation = 'clock_out' and result_code in ('stopped', 'already_stopped'))
  ),
  constraint time_clock_requests_transition_check check (
    (result_code in ('started', 'stopped')) = (time_entry_id is not null)
    or result_code in ('already_working', 'already_stopped')
  ),
  constraint time_clock_requests_snapshot_check check (
    (
      time_entry_id is null
      and result_code = 'already_stopped'
      and started_at is null
      and ended_at is null
    )
    or (
      time_entry_id is not null
      and started_at is not null
      and (
        (operation = 'clock_in' and ended_at is null)
        or (operation = 'clock_out' and ended_at is not null)
      )
    )
  )
);

comment on table private.time_clock_requests is
  'Immutable idempotency outcomes for employee clock commands; no browser access.';

create index time_clock_requests_time_entry_id_idx
  on private.time_clock_requests (time_entry_id)
  where time_entry_id is not null;

create index time_clock_requests_worksite_id_idx
  on private.time_clock_requests (worksite_id);

create function private.can_read_own_time_entry(
  target_organization_id uuid,
  target_membership_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as membership
    join public.organizations as organization
      on organization.id = membership.organization_id
    join auth.users as auth_user on auth_user.id = membership.user_id
    join auth.sessions as auth_session on auth_session.user_id = auth_user.id
    where membership.id = target_membership_id
      and membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'employee'
      and membership.status = 'active'
      and organization.lifecycle_status in ('research_pilot', 'paid_beta')
      and auth_user.email_confirmed_at is not null
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.now())
      and auth_session.id::text = (auth.jwt() ->> 'session_id')
      and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now())
  );
$$;

create function private.clock_in(client_request_id uuid)
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

  -- Both clock functions use this lock order: Auth rows, caller advisory lock,
  -- memberships, organization, worksites, request, then time entry.
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

  select request.* into prior_request
  from private.time_clock_requests as request
  where request.membership_id = target_membership_id
    and request.request_id = client_request_id;
  if found then
    if prior_request.operation <> 'clock_in' then
      raise exception using errcode = '22023', message = 'Tijdregistratie kan niet worden verwerkt.';
    end if;
    return query select prior_request.request_id, prior_request.result_code,
      prior_request.result_code = 'started', prior_request.time_entry_id,
      prior_request.worksite_id, prior_request.started_at, prior_request.ended_at;
    return;
  end if;

  select entry.* into current_entry
  from public.time_entries as entry
  where entry.membership_id = target_membership_id and entry.ended_at is null
  for update;
  if found then
    operation_time := pg_catalog.clock_timestamp();
    insert into private.time_clock_requests (
      membership_id, request_id, operation, result_code, time_entry_id,
      worksite_id, started_at, ended_at, processed_at
    ) values (
      target_membership_id, client_request_id, 'clock_in', 'already_working',
      current_entry.id, current_entry.worksite_id, current_entry.started_at, null,
      operation_time
    );
    return query select client_request_id, 'already_working'::text, false,
      current_entry.id, current_entry.worksite_id, current_entry.started_at,
      null::timestamptz;
    return;
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Tijdregistratie kan niet worden verwerkt.';
  end if;

  insert into public.time_entries (
    organization_id, membership_id, worksite_id, started_at, created_at
  ) values (
    target_organization_id, target_membership_id, target_worksite_id,
    operation_time, operation_time
  ) returning * into current_entry;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action, after_data
  ) values (
    target_organization_id, caller_id, 'time_entry', current_entry.id,
    'time_entry.clocked_in', '{"state":"working"}'::jsonb
  );

  insert into private.time_clock_requests (
    membership_id, request_id, operation, result_code, time_entry_id,
    worksite_id, started_at, ended_at, processed_at
  ) values (
    target_membership_id, client_request_id, 'clock_in', 'started',
    current_entry.id, current_entry.worksite_id, current_entry.started_at, null,
    operation_time
  );

  return query select client_request_id, 'started'::text, true,
    current_entry.id, current_entry.worksite_id, current_entry.started_at,
    null::timestamptz;
end;
$$;

create function private.clock_out(client_request_id uuid)
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

create function private.get_employee_time_clock()
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
        'ended_at', entry.ended_at
      ) order by entry.started_at, entry.id
    ),
    '[]'::jsonb
  ) into entries
  from public.time_entries as entry
  where entry.membership_id = target_membership_id
    and (
      (entry.started_at >= day_start and entry.started_at < day_end)
      or entry.ended_at is null
    );

  return pg_catalog.jsonb_build_object(
    'status', case when current_started_at is null then 'not_working' else 'working' end,
    'current_started_at', current_started_at,
    'server_time', server_time,
    'timezone', 'Europe/Brussels',
    'worksite_id', target_worksite_id,
    'entries', entries
  );
end;
$$;

create function public.clock_in(request_id uuid)
returns table (
  request_id uuid,
  result_code text,
  did_transition boolean,
  time_entry_id uuid,
  worksite_id uuid,
  started_at timestamptz,
  ended_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$ select * from private.clock_in($1); $$;

create function public.clock_out(request_id uuid)
returns table (
  request_id uuid,
  result_code text,
  did_transition boolean,
  time_entry_id uuid,
  worksite_id uuid,
  started_at timestamptz,
  ended_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$ select * from private.clock_out($1); $$;

create function public.get_employee_time_clock()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_employee_time_clock(); $$;

revoke all on table public.time_entries from public, anon, authenticated, service_role;
grant select on table public.time_entries to authenticated, service_role;

revoke all on table private.time_clock_requests from public, anon, authenticated, service_role;

revoke all on function private.can_read_own_time_entry(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.clock_in(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.clock_out(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_employee_time_clock()
  from public, anon, authenticated, service_role;
revoke all on function public.clock_in(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.clock_out(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_employee_time_clock()
  from public, anon, authenticated, service_role;

grant execute on function private.can_read_own_time_entry(uuid, uuid) to authenticated;
grant execute on function private.clock_in(uuid) to authenticated;
grant execute on function private.clock_out(uuid) to authenticated;
grant execute on function private.get_employee_time_clock() to authenticated;
grant execute on function public.clock_in(uuid) to authenticated;
grant execute on function public.clock_out(uuid) to authenticated;
grant execute on function public.get_employee_time_clock() to authenticated;

alter table public.time_entries enable row level security;

create policy time_entries_select_own_active_employee
on public.time_entries
for select
to authenticated
using (
  (select private.can_read_own_time_entry(organization_id, membership_id))
);

comment on function public.clock_in(uuid) is
  'Idempotently start work for the current active employee at the sole database worksite.';
comment on function public.clock_out(uuid) is
  'Idempotently stop the current active employee open entry using database time.';
comment on function public.get_employee_time_clock() is
  'Return current state and Brussels-local today entries for the current active employee.';
