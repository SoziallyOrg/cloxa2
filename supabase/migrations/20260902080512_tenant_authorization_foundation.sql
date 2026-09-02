create schema if not exists private;

comment on schema private is
  'Unexposed authorization and trigger functions for Cloxa.';

revoke all on schema private from public, anon, authenticated, service_role;

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  locale text not null default 'nl-BE',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_not_blank
    check (pg_catalog.btrim(display_name) <> ''),
  constraint profiles_locale_check check (locale in ('nl-BE'))
);

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lifecycle_status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (pg_catalog.btrim(name) <> ''),
  constraint organizations_lifecycle_status_check
    check (lifecycle_status in ('research_pilot', 'paid_beta', 'suspended'))
);

create table public.worksites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  name text not null,
  timezone text not null default 'Europe/Brussels',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worksites_name_not_blank check (pg_catalog.btrim(name) <> ''),
  constraint worksites_timezone_not_blank check (pg_catalog.btrim(timezone) <> '')
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete restrict,
  role text not null,
  status text not null,
  employee_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint memberships_organization_user_key unique (organization_id, user_id),
  constraint memberships_role_check check (role in ('manager', 'employee')),
  constraint memberships_status_check check (status in ('invited', 'active', 'inactive')),
  constraint memberships_employee_code_not_blank
    check (employee_code is null or pg_catalog.btrim(employee_code) <> '')
);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  normalized_email text not null,
  intended_role text not null default 'employee',
  status text not null default 'pending',
  invited_by uuid not null references auth.users (id) on delete restrict,
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete restrict,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_normalized_email_not_blank
    check (pg_catalog.btrim(normalized_email) <> ''),
  constraint invitations_normalized_email_canonical
    check (
      normalized_email = pg_catalog.lower(pg_catalog.btrim(normalized_email))
    ),
  constraint invitations_intended_role_check check (intended_role in ('employee')),
  constraint invitations_status_check
    check (status in ('pending', 'accepted', 'revoked', 'expired')),
  constraint invitations_expiry_check check (expires_at > created_at),
  constraint invitations_state_check check (
    (
      status in ('pending', 'expired')
      and accepted_by is null
      and accepted_at is null
      and revoked_at is null
    )
    or (
      status = 'accepted'
      and accepted_by is not null
      and accepted_at is not null
      and revoked_at is null
      and accepted_at >= created_at
      and accepted_at < expires_at
    )
    or (
      status = 'revoked'
      and accepted_by is null
      and accepted_at is null
      and revoked_at is not null
      and revoked_at >= created_at
    )
  )
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations (id) on delete restrict,
  actor_user_id uuid references auth.users (id) on delete restrict,
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now(),
  constraint audit_events_entity_type_not_blank
    check (pg_catalog.btrim(entity_type) <> ''),
  constraint audit_events_action_not_blank check (pg_catalog.btrim(action) <> '')
);

comment on table public.audit_events is
  'Append-only history. Audit JSON must never contain secrets, auth tokens, or exported files.';

create index organizations_lifecycle_status_idx
  on public.organizations (lifecycle_status);

create index worksites_organization_id_idx
  on public.worksites (organization_id);

create index memberships_user_status_idx
  on public.memberships (user_id, status);

create index memberships_organization_role_idx
  on public.memberships (organization_id, role);

create index memberships_organization_status_idx
  on public.memberships (organization_id, status);

create index invitations_organization_status_idx
  on public.invitations (organization_id, status);

create index invitations_invited_by_idx on public.invitations (invited_by);

create index invitations_accepted_by_idx
  on public.invitations (accepted_by)
  where accepted_by is not null;

create unique index invitations_pending_organization_email_key
  on public.invitations (organization_id, normalized_email)
  where status = 'pending';

create index invitations_pending_email_idx
  on public.invitations (normalized_email)
  where status = 'pending';

create index invitations_pending_expires_at_idx
  on public.invitations (expires_at)
  where status = 'pending';

create index audit_events_organization_created_at_idx
  on public.audit_events (organization_id, created_at desc);

create index audit_events_actor_user_id_idx
  on public.audit_events (actor_user_id)
  where actor_user_id is not null;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.statement_timestamp();
  return new;
end;
$$;

create function private.normalize_invitation_email()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.normalized_email := pg_catalog.lower(pg_catalog.btrim(new.normalized_email));
  return new;
end;
$$;

create function private.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'audit_events are append-only';
  return null;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger worksites_set_updated_at
before update on public.worksites
for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create trigger invitations_normalize_email
before insert or update of normalized_email on public.invitations
for each row execute function private.normalize_invitation_email();

create trigger invitations_set_updated_at
before update on public.invitations
for each row execute function private.set_updated_at();

create trigger audit_events_reject_mutation
before update or delete on public.audit_events
for each row execute function private.reject_audit_event_mutation();

create function private.is_active_org_member(target_organization_id uuid)
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
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and organization.lifecycle_status <> 'suspended'
  );
$$;

create function private.has_org_role(
  target_organization_id uuid,
  required_role text
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
    where membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = required_role
      and membership.status = 'active'
      and organization.lifecycle_status <> 'suspended'
  );
$$;

create function private.can_read_member_profile(target_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships as manager_membership
    join public.memberships as target_membership
      on target_membership.organization_id = manager_membership.organization_id
    join public.organizations as organization
      on organization.id = manager_membership.organization_id
    where manager_membership.user_id = (select auth.uid())
      and manager_membership.role = 'manager'
      and manager_membership.status = 'active'
      and target_membership.user_id = target_user_id
      and organization.lifecycle_status <> 'suspended'
  );
$$;

revoke all on function private.set_updated_at() from public, anon, authenticated, service_role;
revoke all on function private.normalize_invitation_email()
  from public, anon, authenticated, service_role;
revoke all on function private.reject_audit_event_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.is_active_org_member(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.has_org_role(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.can_read_member_profile(uuid)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated;
grant execute on function private.is_active_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, text) to authenticated;
grant execute on function private.can_read_member_profile(uuid) to authenticated;

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.worksites enable row level security;
alter table public.memberships enable row level security;
alter table public.invitations enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_select_own_or_managed_organization
on public.profiles
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select private.can_read_member_profile(user_id))
);

create policy profiles_update_own
on public.profiles
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy organizations_select_active_member
on public.organizations
for select
to authenticated
using ((select private.is_active_org_member(id)));

create policy worksites_select_active_member
on public.worksites
for select
to authenticated
using ((select private.is_active_org_member(organization_id)));

create policy memberships_select_own_or_active_manager
on public.memberships
for select
to authenticated
using (
  (
    user_id = (select auth.uid())
    and status = 'active'
    and (select private.is_active_org_member(organization_id))
  )
  or (select private.has_org_role(organization_id, 'manager'))
);

create policy invitations_select_active_manager
on public.invitations
for select
to authenticated
using ((select private.has_org_role(organization_id, 'manager')));

create policy audit_events_select_active_manager
on public.audit_events
for select
to authenticated
using ((select private.has_org_role(organization_id, 'manager')));

revoke all on table public.profiles from public, anon, authenticated, service_role;
revoke all on table public.organizations from public, anon, authenticated, service_role;
revoke all on table public.worksites from public, anon, authenticated, service_role;
revoke all on table public.memberships from public, anon, authenticated, service_role;
revoke all on table public.invitations from public, anon, authenticated, service_role;
revoke all on table public.audit_events from public, anon, authenticated, service_role;

grant select on table public.profiles to authenticated;
grant update (display_name, locale) on table public.profiles to authenticated;
grant select on table public.organizations to authenticated;
grant select on table public.worksites to authenticated;
grant select on table public.memberships to authenticated;
grant select on table public.invitations to authenticated;
grant select on table public.audit_events to authenticated;

grant select, insert, update, delete on table public.profiles to service_role;
grant select, insert, update, delete on table public.organizations to service_role;
grant select, insert, update, delete on table public.worksites to service_role;
grant select, insert, update, delete on table public.memberships to service_role;
grant select, insert, update, delete on table public.invitations to service_role;
grant select on table public.audit_events to service_role;
