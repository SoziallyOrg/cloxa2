create table private.manager_mfa_registrations (
  auth_user_id uuid primary key,
  provider_factor_id uuid not null unique,
  registered_at timestamptz not null default pg_catalog.clock_timestamp()
);

comment on table private.manager_mfa_registrations is
  'Application registration for a manager TOTP factor. Provider secrets and codes are never stored here.';
comment on column private.manager_mfa_registrations.provider_factor_id is
  'Supabase Auth factor identity derived only from a verified live session.';

alter table private.manager_mfa_registrations enable row level security;
revoke all on table private.manager_mfa_registrations
  from public, anon, authenticated, service_role;

create function private.manager_assurance_context()
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
  'Returns one manager context only when live Supabase Auth session is aal2 and bound to application-registered verified TOTP factor.';

create function private.get_manager_mfa_status()
returns table (manager_mfa_state text, registered_factor_id uuid)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  registration private.manager_mfa_registrations%rowtype;
  base_context record;
begin
  select context.* into base_context
  from private.get_auth_context() as context;

  if base_context.authorization_state is distinct from 'authorized'
    or base_context.membership_role is distinct from 'manager' then
    return query select 'denied'::text, null::uuid;
    return;
  end if;

  select stored.* into registration
  from private.manager_mfa_registrations as stored
  where stored.auth_user_id = caller_id;

  if not found then
    return query select 'setup'::text, null::uuid;
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
    return query select 'recovery_required'::text, null::uuid;
    return;
  end if;

  if exists (select 1 from private.manager_assurance_context()) then
    return query select 'ready'::text, null::uuid;
    return;
  end if;

  return query select 'verify'::text, registration.provider_factor_id;
end;
$$;

create function private.register_manager_mfa()
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
    and (
      auth_user.banned_until is null
      or auth_user.banned_until <= pg_catalog.clock_timestamp()
    )
    and (
      select pg_catalog.count(*)
      from public.memberships as active_membership
      where active_membership.user_id = caller_id
        and active_membership.status = 'active'
    ) = 1
    and (
      auth_session.not_after is null
      or auth_session.not_after > pg_catalog.clock_timestamp()
    )
    and auth_session.aal = 'aal2'::auth.aal_level
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
    )
  for share of auth_user, auth_session, factor, membership, organization;

  if verified_factor_id is null then
    raise exception using errcode = '42501', message = 'manager_mfa_registration_denied';
  end if;

  insert into private.manager_mfa_registrations (
    auth_user_id,
    provider_factor_id
  ) values (
    caller_id,
    verified_factor_id
  )
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
      organization_id,
      actor_user_id,
      entity_type,
      entity_id,
      action,
      after_data
    ) values (
      target_organization_id,
      caller_id,
      'manager_mfa',
      manager_membership_id,
      'manager_mfa.registered',
      '{"state":"registered","factor_type":"totp"}'::jsonb
    );
  end if;

  return 'ready';
end;
$$;

create function public.get_manager_mfa_status()
returns table (manager_mfa_state text, registered_factor_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select status.manager_mfa_state, status.registered_factor_id
  from private.get_manager_mfa_status() as status;
$$;

create function public.register_manager_mfa()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.register_manager_mfa();
$$;

revoke all on function private.manager_assurance_context()
  from public, anon, authenticated, service_role;
revoke all on function private.get_manager_mfa_status()
  from public, anon, authenticated, service_role;
revoke all on function private.register_manager_mfa()
  from public, anon, authenticated, service_role;
revoke all on function public.get_manager_mfa_status()
  from public, anon, authenticated, service_role;
revoke all on function public.register_manager_mfa()
  from public, anon, authenticated, service_role;

grant execute on function private.manager_assurance_context() to authenticated;
grant execute on function private.get_manager_mfa_status() to authenticated;
grant execute on function private.register_manager_mfa() to authenticated;
grant execute on function public.get_manager_mfa_status() to authenticated;
grant execute on function public.register_manager_mfa() to authenticated;

create or replace function private.is_active_org_member(target_organization_id uuid)
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
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and organization.lifecycle_status <> 'suspended'
      and (
        membership.role = 'employee'
        or (
          membership.role = 'manager'
          and exists (
            select 1
            from private.manager_assurance_context() as context
            where context.organization_id = target_organization_id
              and context.manager_membership_id = membership.id
          )
        )
      )
  );
$$;

create or replace function private.has_org_role(
  target_organization_id uuid,
  required_role text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when required_role = 'manager' then exists (
      select 1
      from private.manager_assurance_context() as context
      where context.organization_id = target_organization_id
    )
    else exists (
      select 1
      from public.memberships as membership
      join public.organizations as organization
        on organization.id = membership.organization_id
      where membership.organization_id = target_organization_id
        and membership.user_id = auth.uid()
        and membership.role = required_role
        and membership.status = 'active'
        and organization.lifecycle_status <> 'suspended'
    )
  end;
$$;

create or replace function private.can_read_member_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.manager_assurance_context() as context
    join public.memberships as target_membership
      on target_membership.organization_id = context.organization_id
    where target_membership.user_id = target_user_id
  );
$$;

create or replace function private.manager_review_organization()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select context.organization_id
  from private.manager_assurance_context() as context;
$$;

create or replace function private.manager_admin_context()
returns table (
  manager_membership_id uuid,
  organization_id uuid,
  worksite_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select context.manager_membership_id, context.organization_id, worksite.worksite_id
  from private.manager_assurance_context() as context
  join lateral (
    select
      (pg_catalog.array_agg(site.id order by site.id))[1] as worksite_id,
      pg_catalog.count(*) as worksite_count
    from public.worksites as site
    where site.organization_id = context.organization_id
  ) as worksite on worksite.worksite_count = 1
  where exists (
    select 1
    from public.worksites as fixed_site
    where fixed_site.id = worksite.worksite_id
      and fixed_site.timezone = 'Europe/Brussels'
  );
$$;

create or replace function private.create_employee_invitation(
  employee_email text,
  display_name text default null,
  employee_code text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  canonical_email text := pg_catalog.lower(pg_catalog.btrim(employee_email));
  invitation_name text := nullif(pg_catalog.btrim(display_name), '');
  invitation_code text := nullif(pg_catalog.btrim(employee_code), '');
  active_count bigint;
  target_organization_id uuid;
  invitation_id uuid;
  operation_time timestamptz;
  session_expires_at timestamptz;
begin
  select context.organization_id into target_organization_id
  from private.manager_assurance_context() as context;
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
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
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;

  if canonical_email is null or pg_catalog.length(canonical_email) > 254
    or canonical_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or pg_catalog.length(invitation_name) > 120
    or pg_catalog.length(invitation_code) > 32 then
    raise exception using errcode = '22023', message = 'Controleer de ingevulde gegevens.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17021, pg_catalog.hashtext(canonical_email));
  perform pg_catalog.pg_advisory_xact_lock(17022, pg_catalog.hashtext(caller_id::text));
  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for update;

  select pg_catalog.count(*) into active_count
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active';
  if active_count <> 1 then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;

  select membership.organization_id into target_organization_id
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active'
    and membership.role = 'manager';
  if not found then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;

  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  for share;
  if not found or not exists (
    select 1
    from private.manager_assurance_context() as context
    where context.organization_id = target_organization_id
  ) then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;

  if exists (
    select 1 from auth.users as employee
    join public.memberships as membership on membership.user_id = employee.id
    where pg_catalog.lower(pg_catalog.btrim(employee.email)) = canonical_email
      and (membership.status = 'active'
        or (membership.organization_id = target_organization_id and membership.role = 'manager'))
  ) or exists (
    select 1 from public.invitations as invitation
    join public.organizations as organization on organization.id = invitation.organization_id
    where invitation.normalized_email = canonical_email
      and invitation.status = 'pending' and invitation.revoked_at is null
      and invitation.expires_at > pg_catalog.clock_timestamp()
      and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  ) then
    return null;
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time
    or not exists (
      select 1
      from private.manager_assurance_context() as context
      where context.organization_id = target_organization_id
    ) then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;

  update public.invitations as invitation
  set status = 'expired'
  where invitation.organization_id = target_organization_id
    and invitation.normalized_email = canonical_email
    and invitation.status = 'pending' and invitation.expires_at <= operation_time;

  insert into public.invitations (
    organization_id, normalized_email, intended_role, status, invited_by,
    display_name, employee_code, created_at, expires_at
  ) values (
    target_organization_id, canonical_email, 'employee', 'pending', caller_id,
    invitation_name, invitation_code, operation_time, operation_time + interval '24 hours'
  ) returning id into invitation_id;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action, after_data
  ) values (
    target_organization_id, caller_id, 'invitation', invitation_id,
    'employee_invitation.created', '{"status":"pending","role":"employee"}'::jsonb
  );
  return invitation_id;
end;
$$;
