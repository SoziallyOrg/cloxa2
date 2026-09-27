-- Invitations and onboarding.
--
-- Flow (server actions):
--   1. rpc_invite_member (the inviter's session, fresh MFA): creates the
--      invitation and the employee row (no login yet) with its site
--      assignments. Returns the invitation id.
--   2. The app sends the email with auth.admin.inviteUserByEmail (secret key)
--      and calls rpc_link_invited_user (service_role) with the new auth user:
--      this creates the membership with status 'invited' and attaches the
--      login to the employee row.
--   3. After first login the invited user calls rpc_accept_membership, which
--      activates the membership.
-- A membership needs an auth user, so it is created at link time; the
-- invitation carries the role and sites until then. Supabase owns the email
-- link and its token, so no token is stored here.

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Lowercased; the linked auth user must have exactly this email.
  email text not null,
  role text not null,
  employee_id uuid not null,
  site_ids uuid[] not null default '{}',
  invited_by uuid not null,
  status text not null default 'pending',
  user_id uuid references auth.users (id) on delete restrict,
  membership_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint invitations_organization_id_id_key unique (organization_id, id),
  constraint invitations_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint invitations_membership_fkey
    foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint invitations_email_check check (
    email = lower(email)
    and char_length(email) <= 254
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  -- Ownership is never handed out by invitation.
  constraint invitations_role_check check (role in ('admin', 'manager', 'employee')),
  constraint invitations_status_check check (status in ('pending', 'linked', 'accepted')),
  constraint invitations_site_ids_check
    check (cardinality(site_ids) <= 50 and array_position(site_ids, null) is null),
  constraint invitations_link_check check (
    case status
      when 'pending' then user_id is null and membership_id is null
      else membership_id is not null
    end
  )
);

comment on table public.invitations is
  'Pending member invitations: role and sites until the auth user is linked and accepts.';

-- One open invitation per email and organization.
create unique index invitations_open_email_key
  on public.invitations (organization_id, email)
  where status in ('pending', 'linked');
create index invitations_user_id_idx on public.invitations (user_id) where user_id is not null;
create index invitations_employee_id_idx on public.invitations (organization_id, employee_id);

create trigger invitations_set_updated_at
before update on public.invitations
for each row execute function private.set_updated_at();

create trigger invitations_reject_delete
before delete on public.invitations
for each row execute function private.reject_mutation();

-- rpc_invite_member ------------------------------------------------------------------

create function private.invite_member(
  p_org uuid,
  p_email text,
  p_role text,
  p_display_name text,
  p_site_ids uuid[],
  p_employee_code text default null,
  p_statute text default 'other',
  p_language text default 'nl-BE'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_site_ids uuid[] := coalesce(p_site_ids, '{}');
  v_employee_id uuid;
  v_invitation_id uuid;
begin
  v_membership := private.require_privileged(p_org);

  if p_role is null or p_role not in ('admin', 'manager', 'employee') then
    raise exception using errcode = '22023', message = 'invalid_role';
  end if;

  -- Managers invite employees only; managers and admins come from an owner or admin.
  if v_membership.role = 'manager' and p_role <> 'employee' then
    raise exception using errcode = '42501', message = 'role_not_allowed';
  end if;

  if v_email is null
    or pg_catalog.char_length(v_email) > 254
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  then
    raise exception using errcode = '22023', message = 'invalid_email';
  end if;

  if p_display_name is null
    or pg_catalog.btrim(p_display_name) = ''
    or pg_catalog.char_length(p_display_name) > 200
    or (p_employee_code is not null and (pg_catalog.btrim(p_employee_code) = '' or pg_catalog.char_length(p_employee_code) > 64))
    or p_statute is null
    or p_statute not in ('bediende', 'arbeider', 'student', 'flexi', 'interim', 'other')
    or p_language is null
    or p_language !~ '^[a-z]{2}(-[A-Z]{2})?$'
    or cardinality(v_site_ids) > 50
    or array_position(v_site_ids, null) is not null
  then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select pg_catalog.array_agg(distinct site.id order by site.id)
  into v_site_ids
  from pg_catalog.unnest(v_site_ids) as requested (site_id)
  join public.sites as site
    on site.id = requested.site_id
   and site.organization_id = p_org
   and site.active;

  v_site_ids := coalesce(v_site_ids, '{}');

  if cardinality(v_site_ids) <> (
    select pg_catalog.count(distinct requested.site_id)
    from pg_catalog.unnest(coalesce(p_site_ids, '{}')) as requested (site_id)
  ) then
    raise exception using errcode = '22023', message = 'invalid_site';
  end if;

  -- A manager places people only on sites they manage, and on at least one,
  -- so the new employee is inside their own scope.
  if v_membership.role = 'manager' and (
    cardinality(v_site_ids) = 0
    or exists (
      select 1
      from pg_catalog.unnest(v_site_ids) as requested (site_id)
      where not exists (
        select 1
        from public.site_assignments as managed
        where managed.organization_id = p_org
          and managed.membership_id = v_membership.id
          and managed.site_id = requested.site_id
      )
    )
  ) then
    raise exception using errcode = '42501', message = 'site_not_managed';
  end if;

  if exists (
    select 1
    from public.memberships as member
    join auth.users as auth_user
      on auth_user.id = member.user_id
    where member.organization_id = p_org
      and pg_catalog.lower(auth_user.email) = v_email
  ) then
    raise exception using errcode = '23505', message = 'already_member';
  end if;

  if exists (
    select 1
    from public.invitations as open_invitation
    where open_invitation.organization_id = p_org
      and open_invitation.email = v_email
      and open_invitation.status in ('pending', 'linked')
  ) then
    raise exception using errcode = '23505', message = 'already_invited';
  end if;

  insert into public.employees (organization_id, display_name, employee_code, statute, language)
  values (
    p_org,
    pg_catalog.btrim(p_display_name),
    nullif(pg_catalog.btrim(p_employee_code), ''),
    p_statute,
    p_language
  )
  returning id into v_employee_id;

  insert into public.site_assignments (organization_id, site_id, employee_id)
  select p_org, requested.site_id, v_employee_id
  from pg_catalog.unnest(v_site_ids) as requested (site_id);

  insert into public.invitations (organization_id, email, role, employee_id, site_ids, invited_by)
  values (p_org, v_email, p_role, v_employee_id, v_site_ids, (select auth.uid()))
  returning id into v_invitation_id;

  perform private.write_audit(
    p_org,
    'member.invited',
    'invitation',
    v_invitation_id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee_id,
      'role', p_role,
      'site_ids', pg_catalog.to_jsonb(v_site_ids)
    )
  );

  return v_invitation_id;
end;
$$;

-- rpc_link_invited_user (service_role) -----------------------------------------------

create function private.link_invited_user(p_invitation_id uuid, p_user_id uuid)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
  v_membership_id uuid;
begin
  select invitation.*
  into v_invitation
  from public.invitations as invitation
  where invitation.id = p_invitation_id
  for update;

  if not found or p_user_id is null then
    raise exception using errcode = '22023', message = 'invitation_not_found';
  end if;

  -- Retrying the same link is harmless.
  if v_invitation.status <> 'pending' then
    if v_invitation.user_id = p_user_id then
      return v_invitation.membership_id;
    end if;
    raise exception using errcode = '55000', message = 'invitation_not_pending';
  end if;

  if not exists (
    select 1
    from auth.users as auth_user
    where auth_user.id = p_user_id
      and auth_user.deleted_at is null
      and pg_catalog.lower(auth_user.email) = v_invitation.email
  ) then
    raise exception using errcode = '22023', message = 'user_email_mismatch';
  end if;

  if exists (
    select 1
    from public.memberships as member
    where member.organization_id = v_invitation.organization_id
      and member.user_id = p_user_id
  ) then
    raise exception using errcode = '23505', message = 'already_member';
  end if;

  insert into public.memberships (organization_id, user_id, role, status)
  values (v_invitation.organization_id, p_user_id, v_invitation.role, 'invited')
  returning id into v_membership_id;

  update public.employees as employee
  set user_id = p_user_id
  where employee.organization_id = v_invitation.organization_id
    and employee.id = v_invitation.employee_id
    and employee.user_id is null;

  if not found then
    raise exception using errcode = '55000', message = 'employee_already_linked';
  end if;

  -- An invited manager manages the sites they were invited to.
  if v_invitation.role = 'manager' then
    insert into public.site_assignments (organization_id, site_id, membership_id)
    select v_invitation.organization_id, site.id, v_membership_id
    from public.sites as site
    where site.organization_id = v_invitation.organization_id
      and site.id = any (v_invitation.site_ids);
  end if;

  update public.invitations as invitation
  set status = 'linked',
      user_id = p_user_id,
      membership_id = v_membership_id
  where invitation.id = p_invitation_id;

  perform private.write_audit(
    v_invitation.organization_id,
    'member.linked',
    'invitation',
    v_invitation.id,
    pg_catalog.jsonb_build_object(
      'membership_id', v_membership_id,
      'employee_id', v_invitation.employee_id,
      'user_id', p_user_id
    )
  );

  return v_membership_id;
end;
$$;

-- rpc_accept_membership --------------------------------------------------------------

create function private.accept_membership()
returns table (organization_id uuid, membership_id uuid)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invitation public.invitations;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  for v_invitation in
    select invitation.*
    from public.invitations as invitation
    join public.memberships as member
      on member.organization_id = invitation.organization_id
     and member.id = invitation.membership_id
    where invitation.user_id = v_user_id
      and invitation.status = 'linked'
      and member.user_id = v_user_id
      and member.status = 'invited'
    order by invitation.created_at
    for update of invitation, member
  loop
    update public.memberships as member
    set status = 'active'
    where member.id = v_invitation.membership_id;

    update public.invitations as invitation
    set status = 'accepted'
    where invitation.id = v_invitation.id;

    perform private.write_audit(
      v_invitation.organization_id,
      'member.accepted',
      'membership',
      v_invitation.membership_id,
      pg_catalog.jsonb_build_object('invitation_id', v_invitation.id, 'employee_id', v_invitation.employee_id)
    );

    organization_id := v_invitation.organization_id;
    membership_id := v_invitation.membership_id;
    return next;
  end loop;
end;
$$;

-- rpc_admin_create_organization (service_role) ---------------------------------------

create function public.rpc_admin_create_organization(
  p_name text,
  p_owner_user_id uuid,
  p_owner_display_name text default null
)
returns table (organization_id uuid, site_id uuid, membership_id uuid, employee_id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.create_organization(p_name, p_owner_user_id, p_owner_display_name);
$$;

comment on function public.rpc_admin_create_organization(text, uuid, text) is
  'service_role only: bootstrap an organization with a default site and an owner. Audited.';

-- Public wrappers ----------------------------------------------------------------------

create function public.rpc_invite_member(
  p_org uuid,
  p_email text,
  p_role text,
  p_display_name text,
  p_site_ids uuid[],
  p_employee_code text default null,
  p_statute text default 'other',
  p_language text default 'nl-BE'
)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.invite_member(
    p_org, p_email, p_role, p_display_name, p_site_ids, p_employee_code, p_statute, p_language
  );
$$;

comment on function public.rpc_invite_member(uuid, text, text, text, uuid[], text, text, text) is
  'Privileged (fresh MFA): create an invitation and its employee row. Managers invite employees on managed sites only.';

create function public.rpc_link_invited_user(p_invitation_id uuid, p_user_id uuid)
returns uuid
language sql
volatile
security definer
set search_path = ''
as $$
  select private.link_invited_user(p_invitation_id, p_user_id);
$$;

comment on function public.rpc_link_invited_user(uuid, uuid) is
  'service_role only: attach the invited auth user (same email) and create the invited membership.';

create function public.rpc_accept_membership()
returns table (organization_id uuid, membership_id uuid)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.accept_membership();
$$;

comment on function public.rpc_accept_membership() is
  'Invited user: activate every linked, invited membership of the caller.';

alter table public.invitations enable row level security;

revoke all on table public.invitations from public, anon, authenticated, service_role;
grant select on table public.invitations to authenticated, service_role;

-- Owners and admins see the org's invitations, a manager those they sent, and
-- the invited user their own once linked.
create policy invitations_select_visible
on public.invitations
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (
    private.is_privileged(organization_id)
    and (
      (private.current_membership(organization_id)).role in ('owner', 'admin')
      or invited_by = (select auth.uid())
    )
  )
);

revoke all on function private.invite_member(uuid, text, text, text, uuid[], text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.link_invited_user(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function private.accept_membership() from public, anon, authenticated, service_role;
revoke all on function public.rpc_admin_create_organization(text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_invite_member(uuid, text, text, text, uuid[], text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_link_invited_user(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_accept_membership() from public, anon, authenticated, service_role;

grant execute on function public.rpc_invite_member(uuid, text, text, text, uuid[], text, text, text)
  to authenticated;
grant execute on function public.rpc_accept_membership() to authenticated;
grant execute on function public.rpc_admin_create_organization(text, uuid, text) to service_role;
grant execute on function public.rpc_link_invited_user(uuid, uuid) to service_role;
