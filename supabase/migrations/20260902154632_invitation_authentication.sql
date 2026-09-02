-- Public RPC entry points are SECURITY INVOKER. Privileged implementations stay
-- in the unexposed private schema, bind identity to Auth, and own their audits.
alter table public.invitations
  add column display_name text,
  add column employee_code text,
  add constraint invitations_display_name_check check (
    display_name is null or (
      display_name = pg_catalog.btrim(display_name)
      and pg_catalog.length(display_name) between 1 and 120
    )
  ),
  add constraint invitations_employee_code_check check (
    employee_code is null or (
      employee_code = pg_catalog.btrim(employee_code)
      and pg_catalog.length(employee_code) between 1 and 32
    )
  );

create function private.get_auth_context()
returns table (
  authorization_state text,
  organization_id uuid,
  membership_role text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  active_count bigint;
begin
  if caller_id is null or not exists (
    select 1
    from auth.users as auth_user
    join auth.sessions as auth_session on auth_session.user_id = auth_user.id
    where auth_user.id = caller_id
      and auth_user.email_confirmed_at is not null
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.now())
      and auth_session.id::text = (auth.jwt() ->> 'session_id')
      and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now())
  ) then
    return query select 'unauthorized'::text, null::uuid, null::text;
    return;
  end if;

  -- Count before joining organizations: suspended tenants must not hide a
  -- second active membership and cause arbitrary tenant selection.
  select pg_catalog.count(*) into active_count
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active';

  if active_count > 1 then
    return query select 'unsupported'::text, null::uuid, null::text;
    return;
  end if;

  if active_count = 1 then
    return query
      select 'authorized'::text, membership.organization_id, membership.role
      from public.memberships as membership
      join public.organizations as organization on organization.id = membership.organization_id
      where membership.user_id = caller_id and membership.status = 'active'
        and organization.lifecycle_status in ('research_pilot', 'paid_beta');
    if found then
      return;
    end if;
  end if;

  return query select 'unauthorized'::text, null::uuid, null::text;
end;
$$;

create function private.create_employee_invitation(
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
  -- Lock Auth identity and session so deletion, banning, email changes, and
  -- logout cannot race a successful protected mutation.
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

  -- Consistent lock order: Auth rows, email, user, memberships, organization,
  -- invitation. Hash collisions only serialize unrelated requests.
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
  if not found then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;

  -- NULL deliberately conceals whether an account, membership, or usable
  -- invitation already exists. No email is sent for a duplicate/no-op.
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
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Uitnodiging kan niet worden verwerkt.';
  end if;
  -- Only touch this manager's tenant. Expiry does not otherwise free the
  -- foundation's unique pending-email slot.
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

create function private.get_employee_invitation_state()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  canonical_email text;
  invitation_count bigint;
  target_organization_id uuid;
begin
  select pg_catalog.lower(pg_catalog.btrim(auth_user.email)) into canonical_email
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.now())
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now());
  if caller_id is null or canonical_email is null or canonical_email = '' then
    return 'unavailable';
  end if;

  if exists (
    select 1 from public.memberships as membership
    where membership.user_id = caller_id and membership.status = 'active'
  ) then
    return 'unavailable';
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(invitation.organization_id))[1]
  into invitation_count, target_organization_id
  from public.invitations as invitation
  join public.organizations as organization on organization.id = invitation.organization_id
  where invitation.normalized_email = canonical_email
    and invitation.intended_role = 'employee' and invitation.status = 'pending'
    and invitation.revoked_at is null and invitation.accepted_by is null
    and invitation.expires_at > pg_catalog.now()
    and organization.lifecycle_status in ('research_pilot', 'paid_beta');

  if invitation_count > 1 then
    return 'unsupported';
  end if;
  if invitation_count <> 1 or exists (
    select 1 from public.memberships as membership
    where membership.user_id = caller_id
      and membership.organization_id = target_organization_id
      and membership.role <> 'employee'
  ) then
    return 'unavailable';
  end if;
  return 'ready';
end;
$$;

create function private.accept_employee_invitation()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  canonical_email text;
  invitation_count bigint;
  target_organization_id uuid;
  pending_invitation public.invitations%rowtype;
  employee_membership_id uuid;
  operation_time timestamptz;
  session_expires_at timestamptz;
begin
  select pg_catalog.lower(pg_catalog.btrim(auth_user.email)), auth_session.not_after
  into canonical_email, session_expires_at
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null and auth_user.deleted_at is null
    and coalesce(auth_user.encrypted_password, '') <> ''
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (auth_session.not_after is null or auth_session.not_after > pg_catalog.clock_timestamp())
  for share of auth_user, auth_session;
  if caller_id is null or canonical_email is null or canonical_email = '' then
    raise exception using errcode = '42501', message = 'Deze uitnodiging is niet beschikbaar.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17021, pg_catalog.hashtext(canonical_email));
  perform pg_catalog.pg_advisory_xact_lock(17022, pg_catalog.hashtext(caller_id::text));
  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for update;
  if exists (
    select 1 from public.memberships as membership
    where membership.user_id = caller_id and membership.status = 'active'
  ) then
    raise exception using errcode = '42501', message = 'Deze uitnodiging is niet beschikbaar.';
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(invitation.organization_id))[1]
  into invitation_count, target_organization_id
  from public.invitations as invitation
  join public.organizations as organization on organization.id = invitation.organization_id
  where invitation.normalized_email = canonical_email
    and invitation.intended_role = 'employee' and invitation.status = 'pending'
    and invitation.revoked_at is null and invitation.accepted_by is null
    and invitation.expires_at > pg_catalog.clock_timestamp()
    and organization.lifecycle_status in ('research_pilot', 'paid_beta');
  if invitation_count <> 1 then
    raise exception using errcode = '42501', message = 'Deze uitnodiging is niet beschikbaar.';
  end if;

  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Deze uitnodiging is niet beschikbaar.';
  end if;

  select invitation.* into pending_invitation
  from public.invitations as invitation
  where invitation.organization_id = target_organization_id
    and invitation.normalized_email = canonical_email
    and invitation.intended_role = 'employee' and invitation.status = 'pending'
    and invitation.revoked_at is null and invitation.accepted_by is null
  for update;
  operation_time := pg_catalog.clock_timestamp();
  if not found or pending_invitation.expires_at <= operation_time
    or (session_expires_at is not null and session_expires_at <= operation_time)
    or exists (
      select 1 from public.memberships as membership
      where membership.user_id = caller_id
        and membership.organization_id = target_organization_id
        and membership.role <> 'employee'
    ) then
    raise exception using errcode = '42501', message = 'Deze uitnodiging is niet beschikbaar.';
  end if;

  insert into public.profiles (user_id, display_name, locale)
  values (caller_id, coalesce(pending_invitation.display_name, 'Medewerker'), 'nl-BE')
  on conflict (user_id) do nothing;

  insert into public.memberships as membership (
    organization_id, user_id, role, status, employee_code
  ) values (
    target_organization_id, caller_id, 'employee', 'active', pending_invitation.employee_code
  ) on conflict (organization_id, user_id) do update
    set status = 'active',
      employee_code = coalesce(excluded.employee_code, membership.employee_code)
    where membership.role = 'employee' and membership.status in ('invited', 'inactive')
  returning id into employee_membership_id;
  if employee_membership_id is null then
    raise exception using errcode = '42501', message = 'Deze uitnodiging is niet beschikbaar.';
  end if;

  update public.invitations
  set status = 'accepted', accepted_by = caller_id, accepted_at = operation_time
  where id = pending_invitation.id;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action, after_data
  ) values (
    target_organization_id, caller_id, 'invitation', pending_invitation.id,
    'employee_invitation.accepted',
    pg_catalog.jsonb_build_object('status', 'accepted', 'membership_id', employee_membership_id)
  );
  return employee_membership_id;
end;
$$;

create function public.get_auth_context()
returns table (authorization_state text, organization_id uuid, membership_role text)
language sql stable security invoker set search_path = ''
as $$ select * from private.get_auth_context(); $$;

create function public.create_employee_invitation(
  employee_email text,
  display_name text default null,
  employee_code text default null
)
returns uuid
language sql security invoker set search_path = ''
as $$ select private.create_employee_invitation(employee_email, display_name, employee_code); $$;

create function public.get_employee_invitation_state()
returns text
language sql stable security invoker set search_path = ''
as $$ select private.get_employee_invitation_state(); $$;

create function public.accept_employee_invitation()
returns uuid
language sql security invoker set search_path = ''
as $$ select private.accept_employee_invitation(); $$;

revoke all on function private.get_auth_context() from public, anon, authenticated, service_role;
revoke all on function private.create_employee_invitation(text, text, text) from public, anon, authenticated, service_role;
revoke all on function private.get_employee_invitation_state() from public, anon, authenticated, service_role;
revoke all on function private.accept_employee_invitation() from public, anon, authenticated, service_role;
revoke all on function public.get_auth_context() from public, anon, authenticated, service_role;
revoke all on function public.create_employee_invitation(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.get_employee_invitation_state() from public, anon, authenticated, service_role;
revoke all on function public.accept_employee_invitation() from public, anon, authenticated, service_role;

grant execute on function private.get_auth_context() to authenticated;
grant execute on function private.create_employee_invitation(text, text, text) to authenticated;
grant execute on function private.get_employee_invitation_state() to authenticated;
grant execute on function private.accept_employee_invitation() to authenticated;
grant execute on function public.get_auth_context() to authenticated;
grant execute on function public.create_employee_invitation(text, text, text) to authenticated;
grant execute on function public.get_employee_invitation_state() to authenticated;
grant execute on function public.accept_employee_invitation() to authenticated;

comment on function public.create_employee_invitation(text, text, text) is
  'Employee-only invitation in the caller''s sole active tenant. NULL is a non-disclosing duplicate/no-op.';
comment on function public.accept_employee_invitation() is
  'Accept one pending invitation for the current verified Auth email, after password creation. No browser identity or tenant inputs.';
