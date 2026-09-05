-- Phase 11B: controlled local-development manager TOTP recovery.
-- Provider factor administration remains in the local operator CLI. These database
-- functions are intentionally callable only by the direct local postgres operator.

alter table private.manager_mfa_registrations
  add column generation bigint not null default 1,
  add column session_cutoff_at timestamptz;

comment on column private.manager_mfa_registrations.generation is
  'Monotonic application binding generation; incremented only by controlled recovery completion.';
comment on column private.manager_mfa_registrations.session_cutoff_at is
  'Auth sessions created at or before this database timestamp cannot satisfy manager assurance.';

alter table public.audit_events
  add column actor_type text not null default 'user',
  add constraint audit_events_actor_type_check
    check (actor_type in ('user', 'local_operator'));

comment on column public.audit_events.actor_type is
  'Explicit actor representation. local_operator is reserved for direct local database maintenance and has no fabricated Auth user.';

create table private.manager_mfa_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null references auth.users (id) on delete restrict,
  manager_membership_id uuid not null
    references public.memberships (id) on delete restrict,
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  registration_generation bigint not null,
  registered_factor_id uuid not null,
  registration_registered_at timestamptz not null,
  status text not null,
  start_operation_id uuid not null unique,
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  expires_at timestamptz not null,
  provider_removal_attempted_at timestamptz,
  provider_removal_confirmed_at timestamptz,
  provider_removal_attempts integer not null default 0,
  approved_candidate_id uuid,
  completion_operation_id uuid unique,
  completed_at timestamptz,
  session_cutoff_at timestamptz,
  constraint manager_mfa_recovery_cases_status_check check (
    status in (
      'provider_removal_pending',
      'provider_removal_failed',
      'awaiting_candidate',
      'candidate_verified',
      'expired',
      'completed'
    )
  ),
  constraint manager_mfa_recovery_cases_deadline_check
    check (expires_at = started_at + interval '15 minutes'),
  constraint manager_mfa_recovery_cases_generation_check
    check (registration_generation > 0),
  constraint manager_mfa_recovery_cases_attempts_check
    check (provider_removal_attempts >= 0),
  constraint manager_mfa_recovery_cases_completion_check check (
    (status = 'completed'
      and approved_candidate_id is not null
      and completion_operation_id is not null
      and completed_at is not null
      and session_cutoff_at is not null)
    or
    (status <> 'completed'
      and approved_candidate_id is null
      and completion_operation_id is null
      and completed_at is null
      and session_cutoff_at is null)
  )
);

create unique index manager_mfa_recovery_cases_one_active_user_idx
  on private.manager_mfa_recovery_cases (auth_user_id)
  where status in (
    'provider_removal_pending',
    'provider_removal_failed',
    'awaiting_candidate',
    'candidate_verified'
  );

create index manager_mfa_recovery_cases_user_started_idx
  on private.manager_mfa_recovery_cases (auth_user_id, started_at desc);

create table private.manager_mfa_recovery_candidates (
  id uuid primary key default gen_random_uuid(),
  recovery_case_id uuid not null
    references private.manager_mfa_recovery_cases (id) on delete restrict,
  auth_user_id uuid not null references auth.users (id) on delete restrict,
  provider_factor_id uuid not null,
  auth_session_id uuid not null,
  session_created_at timestamptz not null,
  verified_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint manager_mfa_recovery_candidates_case_factor_session_key
    unique (recovery_case_id, provider_factor_id, auth_session_id)
);

alter table private.manager_mfa_recovery_cases
  add constraint manager_mfa_recovery_cases_approved_candidate_fkey
  foreign key (approved_candidate_id)
  references private.manager_mfa_recovery_candidates (id)
  on delete restrict;

create index manager_mfa_recovery_candidates_case_idx
  on private.manager_mfa_recovery_candidates (recovery_case_id, verified_at desc);

comment on table private.manager_mfa_recovery_cases is
  'Append-preserved local recovery cases. Expiry never removes the old registration or restores access.';
comment on table private.manager_mfa_recovery_candidates is
  'Database-validated native aal2 replacement candidates. Candidate recording never grants manager business access.';
comment on column private.manager_mfa_recovery_candidates.auth_session_id is
  'Private native session evidence; never copied into public audit payloads.';

alter table private.manager_mfa_recovery_cases enable row level security;
alter table private.manager_mfa_recovery_candidates enable row level security;
revoke all on table private.manager_mfa_recovery_cases
  from public, anon, authenticated, service_role;
revoke all on table private.manager_mfa_recovery_candidates
  from public, anon, authenticated, service_role;

create or replace function private.manager_assurance_context()
returns table (
  manager_membership_id uuid,
  organization_id uuid,
  auth_user_id uuid,
  provider_factor_id uuid,
  auth_session_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    membership.id,
    membership.organization_id,
    auth_user.id,
    registration.provider_factor_id,
    auth_session.id
  from public.memberships as membership
  join public.organizations as organization
    on organization.id = membership.organization_id
  join auth.users as auth_user
    on auth_user.id = membership.user_id
  join auth.sessions as auth_session
    on auth_session.user_id = auth_user.id
   and auth_session.id::text = (auth.jwt() ->> 'session_id')
  join private.manager_mfa_registrations as registration
    on registration.auth_user_id = auth_user.id
  join auth.mfa_factors as factor
    on factor.id = registration.provider_factor_id
   and factor.user_id = auth_user.id
  join auth.mfa_amr_claims as amr
    on amr.session_id = auth_session.id
   and amr.authentication_method = 'totp'
  where pg_catalog.current_setting('role', true) = 'authenticated'
    and coalesce(auth.role(), 'authenticated') = 'authenticated'
    and auth_user.id = auth.uid()
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and not coalesce(auth_user.is_anonymous, false)
    and (
      auth_user.banned_until is null
      or auth_user.banned_until <= pg_catalog.clock_timestamp()
    )
    and membership.role = 'manager'
    and membership.status = 'active'
    and (
      select pg_catalog.count(*)
      from public.memberships as active_membership
      where active_membership.user_id = auth_user.id
        and active_membership.status = 'active'
    ) = 1
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
    and (
      auth_session.not_after is null
      or auth_session.not_after > pg_catalog.clock_timestamp()
    )
    and (
      registration.session_cutoff_at is null
      or auth_session.created_at > registration.session_cutoff_at
    )
    and not exists (
      select 1
      from private.manager_mfa_recovery_cases as recovery_case
      where recovery_case.auth_user_id = auth_user.id
        and recovery_case.registration_generation = registration.generation
        and recovery_case.status <> 'completed'
    )
    and auth_session.aal = 'aal2'::auth.aal_level
    and auth_session.factor_id = registration.provider_factor_id
    and factor.factor_type = 'totp'::auth.factor_type
    and factor.status = 'verified'::auth.factor_status
    and (auth.jwt() ->> 'aal') = 'aal2'
    and pg_catalog.jsonb_path_exists(
      auth.jwt(),
      '$.amr[*] ? (@.method == "totp")'::pg_catalog.jsonpath
    )
    and (
      not (auth.jwt() ? 'exp')
      or case
        when pg_catalog.jsonb_typeof(auth.jwt() -> 'exp') = 'number'
          then (auth.jwt() ->> 'exp')::numeric
            > extract(epoch from pg_catalog.clock_timestamp())
        else false
      end
    );
$$;

comment on function private.manager_assurance_context() is
  'Requires registered verified TOTP, live aal2 session, no unresolved recovery, and a provider session created after the recovery cutoff.';

drop function public.get_manager_mfa_status();
drop function private.get_manager_mfa_status();

create function private.get_manager_mfa_status()
returns table (
  manager_mfa_state text,
  registered_factor_id uuid,
  recovery_state text,
  recovery_case_id uuid,
  recovery_expires_at timestamptz,
  recovery_candidate_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  registration private.manager_mfa_registrations%rowtype;
  base_context record;
  recovery_case private.manager_mfa_recovery_cases%rowtype;
  caller_session_id uuid;
  caller_session_created_at timestamptz;
  candidate_id uuid;
begin
  select context.* into base_context
  from private.get_auth_context() as context;

  if base_context.authorization_state is distinct from 'authorized'
    or base_context.membership_role is distinct from 'manager' then
    return query select
      'denied'::text, null::uuid, null::text, null::uuid,
      null::timestamptz, null::uuid;
    return;
  end if;

  select stored.* into registration
  from private.manager_mfa_registrations as stored
  where stored.auth_user_id = caller_id;

  if not found then
    if exists (
      select 1 from private.manager_mfa_recovery_cases as historical
      where historical.auth_user_id = caller_id
    ) then
      return query select
        'recovery_required'::text, null::uuid, 'operator_action_required'::text,
        null::uuid, null::timestamptz, null::uuid;
    else
      return query select
        'setup'::text, null::uuid, null::text, null::uuid,
        null::timestamptz, null::uuid;
    end if;
    return;
  end if;

  select stored_case.* into recovery_case
  from private.manager_mfa_recovery_cases as stored_case
  where stored_case.auth_user_id = caller_id
    and stored_case.registration_generation = registration.generation
    and stored_case.status <> 'completed'
  order by stored_case.started_at desc
  limit 1;

  if found then
    if recovery_case.expires_at <= pg_catalog.clock_timestamp()
      or recovery_case.status = 'expired' then
      return query select
        'recovery_required'::text, null::uuid, 'expired'::text,
        null::uuid, recovery_case.expires_at, null::uuid;
      return;
    end if;

    if recovery_case.status in ('provider_removal_pending', 'provider_removal_failed') then
      return query select
        'recovery_required'::text, null::uuid, 'operator_action_required'::text,
        null::uuid, recovery_case.expires_at, null::uuid;
      return;
    end if;

    begin
      caller_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    exception when others then
      caller_session_id := null;
    end;

    select candidate.id into candidate_id
    from private.manager_mfa_recovery_candidates as candidate
    where candidate.recovery_case_id = recovery_case.id
      and candidate.auth_user_id = caller_id
      and candidate.auth_session_id = caller_session_id
    order by candidate.verified_at desc
    limit 1;

    return query select
      'recovery_required'::text,
      null::uuid,
      case when candidate_id is null then 'active' else 'awaiting_operator' end::text,
      recovery_case.id,
      recovery_case.expires_at,
      candidate_id;
    return;
  end if;

  if not exists (
    select 1
    from auth.mfa_factors as factor
    where factor.id = registration.provider_factor_id
      and factor.user_id = caller_id
      and factor.factor_type = 'totp'::auth.factor_type
      and factor.status = 'verified'::auth.factor_status
  ) then
    return query select
      'recovery_required'::text, null::uuid, 'operator_action_required'::text,
      null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  begin
    caller_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  exception when others then
    caller_session_id := null;
  end;

  select auth_session.created_at into caller_session_created_at
  from auth.sessions as auth_session
  where auth_session.id = caller_session_id
    and auth_session.user_id = caller_id;

  if registration.session_cutoff_at is not null
    and (
      caller_session_created_at is null
      or caller_session_created_at <= registration.session_cutoff_at
    ) then
    return query select
      'recovery_required'::text, null::uuid, 'fresh_login_required'::text,
      null::uuid, null::timestamptz, null::uuid;
    return;
  end if;

  if exists (select 1 from private.manager_assurance_context()) then
    return query select
      'ready'::text, null::uuid, null::text, null::uuid,
      null::timestamptz, null::uuid;
    return;
  end if;

  return query select
    'verify'::text, registration.provider_factor_id, null::text,
    null::uuid, null::timestamptz, null::uuid;
end;
$$;

create function public.get_manager_mfa_status()
returns table (
  manager_mfa_state text,
  registered_factor_id uuid,
  recovery_state text,
  recovery_case_id uuid,
  recovery_expires_at timestamptz,
  recovery_candidate_id uuid
)
language sql
volatile
security invoker
set search_path = ''
as $$
  select status.*
  from private.get_manager_mfa_status() as status;
$$;

create or replace function private.register_manager_mfa()
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  verified_factor_id uuid;
  stored_factor_id uuid;
  manager_membership_id uuid;
  target_organization_id uuid;
  was_inserted boolean := false;
  inserted_count bigint := 0;
begin
  if caller_id is null then
    raise exception using errcode = '42501', message = 'manager_mfa_registration_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    17061,
    pg_catalog.hashtext(caller_id::text)
  );

  if exists (
    select 1 from private.manager_mfa_recovery_cases as recovery_case
    where recovery_case.auth_user_id = caller_id
  ) then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_required';
  end if;

  select auth_session.factor_id, membership.id, membership.organization_id
  into verified_factor_id, manager_membership_id, target_organization_id
  from auth.users as auth_user
  join auth.sessions as auth_session
    on auth_session.user_id = auth_user.id
   and auth_session.id::text = (auth.jwt() ->> 'session_id')
  join auth.mfa_factors as factor
    on factor.id = auth_session.factor_id
   and factor.user_id = auth_user.id
  join auth.mfa_amr_claims as amr
    on amr.session_id = auth_session.id
   and amr.authentication_method = 'totp'
  join public.memberships as membership
    on membership.user_id = auth_user.id
   and membership.role = 'manager'
   and membership.status = 'active'
  join public.organizations as organization
    on organization.id = membership.organization_id
   and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  where pg_catalog.current_setting('role', true) = 'authenticated'
    and coalesce(auth.role(), 'authenticated') = 'authenticated'
    and auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and not coalesce(auth_user.is_anonymous, false)
    and (auth_user.banned_until is null
      or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and (
      select pg_catalog.count(*)
      from public.memberships as active_membership
      where active_membership.user_id = caller_id
        and active_membership.status = 'active'
    ) = 1
    and (auth_session.not_after is null
      or auth_session.not_after > pg_catalog.clock_timestamp())
    and auth_session.aal = 'aal2'::auth.aal_level
    and factor.factor_type = 'totp'::auth.factor_type
    and factor.status = 'verified'::auth.factor_status
    and (auth.jwt() ->> 'aal') = 'aal2'
    and pg_catalog.jsonb_path_exists(
      auth.jwt(), '$.amr[*] ? (@.method == "totp")'::pg_catalog.jsonpath
    )
    and (
      not (auth.jwt() ? 'exp')
      or case
        when pg_catalog.jsonb_typeof(auth.jwt() -> 'exp') = 'number'
          then (auth.jwt() ->> 'exp')::numeric
            > extract(epoch from pg_catalog.clock_timestamp())
        else false
      end
    )
  for share of auth_user, auth_session, factor, membership, organization;

  if verified_factor_id is null then
    raise exception using errcode = '42501', message = 'manager_mfa_registration_denied';
  end if;

  insert into private.manager_mfa_registrations (auth_user_id, provider_factor_id)
  values (caller_id, verified_factor_id)
  on conflict (auth_user_id) do nothing;
  get diagnostics inserted_count = row_count;
  was_inserted := inserted_count = 1;

  select registration.provider_factor_id into stored_factor_id
  from private.manager_mfa_registrations as registration
  where registration.auth_user_id = caller_id;

  if stored_factor_id is distinct from verified_factor_id then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_required';
  end if;

  if was_inserted then
    insert into public.audit_events (
      organization_id, actor_user_id, entity_type, entity_id, action, after_data
    ) values (
      target_organization_id, caller_id, 'manager_mfa', manager_membership_id,
      'manager_mfa.registered',
      '{"state":"registered","factor_type":"totp"}'::jsonb
    );
  end if;

  return 'ready';
end;
$$;

create function private.record_manager_mfa_recovery_candidate(target_case_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  candidate_id uuid;
  live_factor_id uuid;
  live_session_id uuid;
  live_session_created_at timestamptz;
  active_case private.manager_mfa_recovery_cases%rowtype;
begin
  if caller_id is null or target_case_id is null
    or pg_catalog.current_setting('role', true) <> 'authenticated'
    or coalesce(auth.role(), 'authenticated') <> 'authenticated' then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_candidate_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17062, pg_catalog.hashtext(caller_id::text));

  select recovery_case.* into active_case
  from private.manager_mfa_recovery_cases as recovery_case
  where recovery_case.id = target_case_id
    and recovery_case.auth_user_id = caller_id
  for update;

  if not found
    or active_case.status not in ('awaiting_candidate', 'candidate_verified')
    or active_case.provider_removal_confirmed_at is null
    or active_case.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_candidate_denied';
  end if;

  select auth_session.id, auth_session.factor_id, auth_session.created_at
  into live_session_id, live_factor_id, live_session_created_at
  from auth.users as auth_user
  join auth.sessions as auth_session
    on auth_session.user_id = auth_user.id
   and auth_session.id::text = (auth.jwt() ->> 'session_id')
  join auth.mfa_factors as factor
    on factor.id = auth_session.factor_id
   and factor.user_id = auth_user.id
  join auth.mfa_amr_claims as amr
    on amr.session_id = auth_session.id
   and amr.authentication_method = 'totp'
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and not coalesce(auth_user.is_anonymous, false)
    and (auth_user.banned_until is null
      or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and (auth_session.not_after is null
      or auth_session.not_after > pg_catalog.clock_timestamp())
    and auth_session.created_at >= active_case.started_at
    and auth_session.aal = 'aal2'::auth.aal_level
    and factor.factor_type = 'totp'::auth.factor_type
    and factor.status = 'verified'::auth.factor_status
    and factor.created_at >= active_case.provider_removal_confirmed_at
    and factor.created_at < active_case.expires_at
    and factor.id <> active_case.registered_factor_id
    and (auth.jwt() ->> 'aal') = 'aal2'
    and pg_catalog.jsonb_path_exists(
      auth.jwt(), '$.amr[*] ? (@.method == "totp")'::pg_catalog.jsonpath
    )
    and (
      not (auth.jwt() ? 'exp')
      or case
        when pg_catalog.jsonb_typeof(auth.jwt() -> 'exp') = 'number'
          then (auth.jwt() ->> 'exp')::numeric
            > extract(epoch from pg_catalog.clock_timestamp())
        else false
      end
    )
  for share of auth_user, auth_session, factor;

  if live_factor_id is null then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_candidate_denied';
  end if;

  insert into private.manager_mfa_recovery_candidates (
    recovery_case_id, auth_user_id, provider_factor_id,
    auth_session_id, session_created_at
  ) values (
    active_case.id, caller_id, live_factor_id,
    live_session_id, live_session_created_at
  )
  on conflict (recovery_case_id, provider_factor_id, auth_session_id)
  do update set verified_at = private.manager_mfa_recovery_candidates.verified_at
  returning id into candidate_id;

  update private.manager_mfa_recovery_cases
  set status = 'candidate_verified'
  where id = active_case.id
    and status in ('awaiting_candidate', 'candidate_verified');

  return candidate_id;
end;
$$;

create function public.record_manager_mfa_recovery_candidate(target_case_id uuid)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.record_manager_mfa_recovery_candidate(target_case_id);
$$;

create function private.expire_local_manager_mfa_recovery(target_user_id uuid)
returns void
language sql
volatile
security invoker
set search_path = ''
as $$
  update private.manager_mfa_recovery_cases as recovery_case
  set status = 'expired'
  where recovery_case.auth_user_id = target_user_id
    and recovery_case.status in (
      'provider_removal_pending', 'provider_removal_failed',
      'awaiting_candidate', 'candidate_verified'
    )
    and recovery_case.expires_at <= pg_catalog.clock_timestamp();
$$;

create function private.start_local_manager_mfa_recovery(
  target_user_id uuid,
  operation_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  registration private.manager_mfa_registrations%rowtype;
  manager_membership record;
  operation_case private.manager_mfa_recovery_cases%rowtype;
  created_case private.manager_mfa_recovery_cases%rowtype;
  operation_time timestamptz;
begin
  if session_user <> 'postgres' or target_user_id is null or operation_id is null then
    raise exception using errcode = '42501', message = 'local_manager_mfa_operator_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17063, pg_catalog.hashtext(target_user_id::text));

  select recovery_case.* into operation_case
  from private.manager_mfa_recovery_cases as recovery_case
  where recovery_case.start_operation_id = operation_id
     or recovery_case.completion_operation_id = operation_id
  order by recovery_case.started_at
  limit 1;

  if found then
    if operation_case.start_operation_id = operation_id
      and operation_case.auth_user_id = target_user_id then
      return pg_catalog.jsonb_build_object(
        'case_id', operation_case.id,
        'factor_id', operation_case.registered_factor_id,
        'status', operation_case.status,
        'expires_at', operation_case.expires_at
      );
    end if;
    raise exception using errcode = '22023', message = 'manager_mfa_recovery_operation_reused';
  end if;

  perform private.expire_local_manager_mfa_recovery(target_user_id);

  if exists (
    select 1 from private.manager_mfa_recovery_cases as active_case
    where active_case.auth_user_id = target_user_id
      and active_case.status in (
        'provider_removal_pending', 'provider_removal_failed',
        'awaiting_candidate', 'candidate_verified'
      )
  ) then
    raise exception using errcode = '55000', message = 'manager_mfa_recovery_already_active';
  end if;

  select stored.* into registration
  from private.manager_mfa_registrations as stored
  where stored.auth_user_id = target_user_id
  for update;

  select membership.id, membership.organization_id into manager_membership
  from auth.users as auth_user
  join public.memberships as membership
    on membership.user_id = auth_user.id
   and membership.role = 'manager'
   and membership.status = 'active'
  join public.organizations as organization
    on organization.id = membership.organization_id
   and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  where auth_user.id = target_user_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and not coalesce(auth_user.is_anonymous, false)
    and auth_user.raw_app_meta_data ->> 'cloxa_local_fixture'
      in ('cloxa-local-manager-v1', 'manager-mfa-v1')
    and (
      select pg_catalog.count(*)
      from public.memberships as active_membership
      where active_membership.user_id = target_user_id
        and active_membership.status = 'active'
    ) = 1
  for share of auth_user, membership, organization;

  if registration.auth_user_id is null or manager_membership.id is null then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_target_denied';
  end if;

  operation_time := pg_catalog.clock_timestamp();
  insert into private.manager_mfa_recovery_cases (
    auth_user_id, manager_membership_id, organization_id,
    registration_generation, registered_factor_id, registration_registered_at, status,
    start_operation_id, started_at, expires_at
  ) values (
    target_user_id, manager_membership.id, manager_membership.organization_id,
    registration.generation, registration.provider_factor_id, registration.registered_at,
    'provider_removal_pending', operation_id,
    operation_time, operation_time + interval '15 minutes'
  ) returning * into created_case;

  insert into public.audit_events (
    organization_id, actor_user_id, actor_type,
    entity_type, entity_id, action, after_data, created_at
  ) values (
    created_case.organization_id, null, 'local_operator',
    'manager_mfa_recovery', created_case.id,
    'manager_mfa.recovery_started',
    '{"state":"started","window_seconds":900}'::jsonb,
    operation_time
  );

  return pg_catalog.jsonb_build_object(
    'case_id', created_case.id,
    'factor_id', created_case.registered_factor_id,
    'status', created_case.status,
    'expires_at', created_case.expires_at
  );
end;
$$;

create function private.record_local_manager_mfa_provider_result(
  target_user_id uuid,
  target_case_id uuid,
  operation_id uuid,
  expected_factor_id uuid,
  removal_succeeded boolean
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  recovery_case private.manager_mfa_recovery_cases%rowtype;
  operation_time timestamptz := pg_catalog.clock_timestamp();
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'local_manager_mfa_operator_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17063, pg_catalog.hashtext(target_user_id::text));
  perform private.expire_local_manager_mfa_recovery(target_user_id);

  select stored.* into recovery_case
  from private.manager_mfa_recovery_cases as stored
  where stored.id = target_case_id
    and stored.auth_user_id = target_user_id
    and stored.start_operation_id = operation_id
    and stored.registered_factor_id = expected_factor_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'manager_mfa_recovery_payload_changed';
  end if;

  if recovery_case.status = 'expired' then
    return pg_catalog.jsonb_build_object(
      'case_id', recovery_case.id, 'status', recovery_case.status
    );
  end if;

  if recovery_case.status in ('awaiting_candidate', 'candidate_verified') then
    if not removal_succeeded then
      raise exception using errcode = '22023', message = 'manager_mfa_recovery_payload_changed';
    end if;
    return pg_catalog.jsonb_build_object(
      'case_id', recovery_case.id,
      'status', recovery_case.status,
      'expires_at', recovery_case.expires_at
    );
  end if;

  if recovery_case.status not in ('provider_removal_pending', 'provider_removal_failed') then
    raise exception using errcode = '55000', message = 'manager_mfa_recovery_not_active';
  end if;

  update private.manager_mfa_recovery_cases
  set
    status = case when removal_succeeded
      then 'awaiting_candidate' else 'provider_removal_failed' end,
    provider_removal_attempted_at = operation_time,
    provider_removal_confirmed_at = case when removal_succeeded
      then operation_time else provider_removal_confirmed_at end,
    provider_removal_attempts = provider_removal_attempts + 1
  where id = recovery_case.id
  returning * into recovery_case;

  return pg_catalog.jsonb_build_object(
    'case_id', recovery_case.id,
    'status', recovery_case.status,
    'expires_at', recovery_case.expires_at
  );
end;
$$;

create function private.get_local_manager_mfa_recovery_status(
  target_user_id uuid,
  target_case_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  recovery_case private.manager_mfa_recovery_cases%rowtype;
  candidate_count bigint;
  candidate_ids jsonb;
begin
  if session_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'local_manager_mfa_operator_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17063, pg_catalog.hashtext(target_user_id::text));
  perform private.expire_local_manager_mfa_recovery(target_user_id);

  select stored.* into recovery_case
  from private.manager_mfa_recovery_cases as stored
  where stored.id = target_case_id
    and stored.auth_user_id = target_user_id;

  if not found then
    raise exception using errcode = '22023', message = 'manager_mfa_recovery_case_not_found';
  end if;

  select
    pg_catalog.count(*),
    coalesce(
      pg_catalog.jsonb_agg(candidate.id order by candidate.verified_at),
      '[]'::jsonb
    )
  into candidate_count, candidate_ids
  from private.manager_mfa_recovery_candidates as candidate
  where candidate.recovery_case_id = recovery_case.id;

  return pg_catalog.jsonb_build_object(
    'case_id', recovery_case.id,
    'status', recovery_case.status,
    'expires_at', recovery_case.expires_at,
    'candidate_count', candidate_count,
    'candidate_ids', candidate_ids,
    'approved_candidate_id', recovery_case.approved_candidate_id,
    'generation', recovery_case.registration_generation
  );
end;
$$;

create function private.complete_local_manager_mfa_recovery(
  target_user_id uuid,
  target_case_id uuid,
  target_candidate_id uuid,
  operation_id uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  recovery_case private.manager_mfa_recovery_cases%rowtype;
  operation_case private.manager_mfa_recovery_cases%rowtype;
  registration private.manager_mfa_registrations%rowtype;
  candidate private.manager_mfa_recovery_candidates%rowtype;
  operation_time timestamptz;
begin
  if session_user <> 'postgres'
    or target_user_id is null or target_case_id is null
    or target_candidate_id is null or operation_id is null then
    raise exception using errcode = '42501', message = 'local_manager_mfa_operator_denied';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17063, pg_catalog.hashtext(target_user_id::text));

  select stored.* into operation_case
  from private.manager_mfa_recovery_cases as stored
  where stored.start_operation_id = operation_id
     or stored.completion_operation_id = operation_id
  order by stored.started_at
  limit 1;

  if found then
    if operation_case.completion_operation_id = operation_id
      and operation_case.id = target_case_id
      and operation_case.auth_user_id = target_user_id
      and operation_case.approved_candidate_id = target_candidate_id
      and operation_case.status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'case_id', operation_case.id,
        'candidate_id', operation_case.approved_candidate_id,
        'status', operation_case.status,
        'generation', operation_case.registration_generation + 1,
        'session_cutoff_at', operation_case.session_cutoff_at
      );
    end if;
    raise exception using errcode = '22023', message = 'manager_mfa_recovery_operation_reused';
  end if;

  perform private.expire_local_manager_mfa_recovery(target_user_id);

  select stored.* into recovery_case
  from private.manager_mfa_recovery_cases as stored
  where stored.id = target_case_id
    and stored.auth_user_id = target_user_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'manager_mfa_recovery_case_not_found';
  end if;

  if recovery_case.status = 'expired' then
    return pg_catalog.jsonb_build_object(
      'case_id', recovery_case.id, 'status', recovery_case.status
    );
  end if;

  if recovery_case.status <> 'candidate_verified'
    or recovery_case.provider_removal_confirmed_at is null
    or recovery_case.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000', message = 'manager_mfa_recovery_not_completable';
  end if;

  select stored.* into registration
  from private.manager_mfa_registrations as stored
  where stored.auth_user_id = target_user_id
  for update;

  select stored.* into candidate
  from private.manager_mfa_recovery_candidates as stored
  where stored.id = target_candidate_id
    and stored.recovery_case_id = recovery_case.id
    and stored.auth_user_id = target_user_id
  for share;

  if registration.auth_user_id is null or candidate.id is null
    or registration.generation <> recovery_case.registration_generation
    or registration.provider_factor_id <> recovery_case.registered_factor_id
    or candidate.provider_factor_id = recovery_case.registered_factor_id
    or candidate.verified_at >= recovery_case.expires_at
    or exists (
      select 1 from auth.mfa_factors as old_factor
      where old_factor.id = recovery_case.registered_factor_id
        and old_factor.user_id = target_user_id
    )
    or not exists (
      select 1
      from auth.sessions as auth_session
      join auth.mfa_factors as factor
        on factor.id = auth_session.factor_id
       and factor.user_id = auth_session.user_id
      join auth.mfa_amr_claims as amr
        on amr.session_id = auth_session.id
       and amr.authentication_method = 'totp'
      where auth_session.id = candidate.auth_session_id
        and auth_session.user_id = target_user_id
        and auth_session.factor_id = candidate.provider_factor_id
        and auth_session.created_at = candidate.session_created_at
        and auth_session.aal = 'aal2'::auth.aal_level
        and (auth_session.not_after is null
          or auth_session.not_after > pg_catalog.clock_timestamp())
        and factor.id = candidate.provider_factor_id
        and factor.factor_type = 'totp'::auth.factor_type
        and factor.status = 'verified'::auth.factor_status
    ) then
    raise exception using errcode = '42501', message = 'manager_mfa_recovery_completion_denied';
  end if;

  operation_time := pg_catalog.clock_timestamp();

  update private.manager_mfa_registrations
  set provider_factor_id = candidate.provider_factor_id,
      generation = registration.generation + 1,
      registered_at = operation_time,
      session_cutoff_at = operation_time
  where auth_user_id = target_user_id
    and generation = registration.generation
    and provider_factor_id = registration.provider_factor_id;

  if not found then
    raise exception using errcode = '40001', message = 'manager_mfa_recovery_binding_changed';
  end if;

  update private.manager_mfa_recovery_cases
  set status = 'completed',
      approved_candidate_id = candidate.id,
      completion_operation_id = operation_id,
      completed_at = operation_time,
      session_cutoff_at = operation_time
  where id = recovery_case.id;

  insert into public.audit_events (
    organization_id, actor_user_id, actor_type,
    entity_type, entity_id, action, after_data, created_at
  ) values (
    recovery_case.organization_id, null, 'local_operator',
    'manager_mfa_recovery', recovery_case.id,
    'manager_mfa.recovery_completed',
    pg_catalog.jsonb_build_object(
      'state', 'completed',
      'factor_type', 'totp',
      'generation', registration.generation + 1
    ),
    operation_time
  );

  return pg_catalog.jsonb_build_object(
    'case_id', recovery_case.id,
    'candidate_id', candidate.id,
    'status', 'completed',
    'generation', registration.generation + 1,
    'session_cutoff_at', operation_time
  );
end;
$$;

revoke all on function private.get_manager_mfa_status()
  from public, anon, authenticated, service_role;
revoke all on function public.get_manager_mfa_status()
  from public, anon, authenticated, service_role;
revoke all on function private.record_manager_mfa_recovery_candidate(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_manager_mfa_recovery_candidate(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.expire_local_manager_mfa_recovery(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.start_local_manager_mfa_recovery(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.record_local_manager_mfa_provider_result(
  uuid, uuid, uuid, uuid, boolean
) from public, anon, authenticated, service_role;
revoke all on function private.get_local_manager_mfa_recovery_status(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.complete_local_manager_mfa_recovery(
  uuid, uuid, uuid, uuid
) from public, anon, authenticated, service_role;

grant execute on function private.get_manager_mfa_status() to authenticated;
grant execute on function public.get_manager_mfa_status() to authenticated;
grant execute on function private.record_manager_mfa_recovery_candidate(uuid)
  to authenticated;
grant execute on function public.record_manager_mfa_recovery_candidate(uuid)
  to authenticated;

comment on function private.start_local_manager_mfa_recovery(uuid, uuid) is
  'Direct-postgres local operator entry point. Starts one bounded case and blocks manager assurance before provider removal.';
comment on function private.complete_local_manager_mfa_recovery(uuid, uuid, uuid, uuid) is
  'Direct-postgres local operator entry point. Revalidates and atomically approves one exact candidate with a session cutoff.';
