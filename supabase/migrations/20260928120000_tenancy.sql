-- Tenancy and identity (docs/architecture.md, "Tenancy and identity").
-- Every tenant table carries organization_id; composite foreign keys on
-- (organization_id, id) make cross-tenant references impossible. Clients only
-- read through RLS (policies live in the access-helpers migration); all writes
-- go through private SECURITY DEFINER functions.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;

comment on schema private is
  'Unexposed authorization, hash-chain and RPC implementation functions.';

revoke all on schema private from public, anon, authenticated, service_role;

-- RLS policies call private helpers as the requesting role, so authenticated
-- needs USAGE. The schema is not in api.schemas, so nothing here is reachable
-- over PostgREST.
grant usage on schema private to authenticated, service_role;

-- Functions are executable by PUBLIC unless revoked; never let that default
-- apply in private.
alter default privileges in schema private revoke execute on functions from public;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end;
$$;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'Europe/Brussels',
  settings jsonb not null default '{"location_capture": "off", "retention_years": 5}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint organizations_name_check
    check (btrim(name) <> '' and char_length(name) <= 200),
  constraint organizations_timezone_check check (btrim(timezone) <> ''),
  -- CASE guards the numeric cast: AND does not guarantee evaluation order.
  constraint organizations_settings_check check (
    case
      when jsonb_typeof(settings) <> 'object' then false
      when jsonb_typeof(settings -> 'retention_years') is distinct from 'number' then false
      else settings ->> 'location_capture' in ('off', 'clock_points')
        and (settings -> 'retention_years')::numeric >= 5
    end
  )
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  name text not null,
  address text,
  timezone text not null default 'Europe/Brussels',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint sites_organization_id_id_key unique (organization_id, id),
  constraint sites_name_check check (btrim(name) <> '' and char_length(name) <= 200),
  constraint sites_address_check check (address is null or char_length(address) <= 500),
  constraint sites_timezone_check check (btrim(timezone) <> '')
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null,
  status text not null default 'invited',
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint memberships_organization_id_user_id_key unique (organization_id, user_id),
  constraint memberships_organization_id_id_key unique (organization_id, id),
  constraint memberships_role_check check (role in ('owner', 'admin', 'manager', 'employee')),
  constraint memberships_status_check check (status in ('invited', 'active', 'suspended'))
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Null for kiosk-only workers without a login.
  user_id uuid,
  display_name text not null,
  employee_code text,
  statute text not null default 'other',
  language text not null default 'nl-BE',
  active boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint employees_organization_id_id_key unique (organization_id, id),
  -- A login maps to at most one employee row per organization, and only
  -- through a membership of that same organization. People are deactivated
  -- by status, never detached from their history, so deleting the membership
  -- (or the auth user behind it) is refused.
  constraint employees_organization_id_user_id_key unique (organization_id, user_id),
  constraint employees_membership_fkey
    foreign key (organization_id, user_id)
    references public.memberships (organization_id, user_id)
    on delete restrict,
  constraint employees_display_name_check
    check (btrim(display_name) <> '' and char_length(display_name) <= 200),
  constraint employees_employee_code_check
    check (employee_code is null or (btrim(employee_code) <> '' and char_length(employee_code) <= 64)),
  constraint employees_statute_check
    check (statute in ('bediende', 'arbeider', 'student', 'flexi', 'interim', 'other')),
  constraint employees_language_check check (language ~ '^[a-z]{2}(-[A-Z]{2})?$')
);

create unique index employees_organization_id_employee_code_key
  on public.employees (organization_id, employee_code)
  where employee_code is not null;

-- Employees -> sites they clock at; manager memberships -> sites they manage.
create table public.site_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  site_id uuid not null,
  employee_id uuid,
  membership_id uuid,
  created_at timestamptz not null default clock_timestamp(),
  constraint site_assignments_site_fkey
    foreign key (organization_id, site_id)
    references public.sites (organization_id, id) on delete restrict,
  constraint site_assignments_employee_fkey
    foreign key (organization_id, employee_id)
    references public.employees (organization_id, id) on delete restrict,
  constraint site_assignments_membership_fkey
    foreign key (organization_id, membership_id)
    references public.memberships (organization_id, id) on delete cascade,
  constraint site_assignments_one_subject_check check (num_nonnulls(employee_id, membership_id) = 1),
  constraint site_assignments_site_employee_key unique (organization_id, site_id, employee_id),
  constraint site_assignments_site_membership_key unique (organization_id, site_id, membership_id)
);

-- Lookup paths used by the RLS helpers and the clock RPC.
create index memberships_user_id_idx on public.memberships (user_id);
create index sites_organization_id_idx on public.sites (organization_id);
create index employees_user_id_idx on public.employees (user_id) where user_id is not null;
create index site_assignments_employee_site_idx
  on public.site_assignments (employee_id, site_id) where employee_id is not null;
create index site_assignments_membership_site_idx
  on public.site_assignments (membership_id, site_id) where membership_id is not null;
create index site_assignments_site_id_idx on public.site_assignments (site_id);

create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function private.set_updated_at();

create trigger sites_set_updated_at
before update on public.sites
for each row execute function private.set_updated_at();

create trigger memberships_set_updated_at
before update on public.memberships
for each row execute function private.set_updated_at();

create trigger employees_set_updated_at
before update on public.employees
for each row execute function private.set_updated_at();

alter table public.organizations enable row level security;
alter table public.sites enable row level security;
alter table public.memberships enable row level security;
alter table public.employees enable row level security;
alter table public.site_assignments enable row level security;

-- Default-deny, then grant only reads. Writes happen exclusively inside
-- private SECURITY DEFINER functions owned by postgres.
revoke all on table public.organizations from public, anon, authenticated, service_role;
revoke all on table public.sites from public, anon, authenticated, service_role;
revoke all on table public.memberships from public, anon, authenticated, service_role;
revoke all on table public.employees from public, anon, authenticated, service_role;
revoke all on table public.site_assignments from public, anon, authenticated, service_role;

grant select on table public.organizations to authenticated, service_role;
grant select on table public.sites to authenticated, service_role;
grant select on table public.memberships to authenticated, service_role;
grant select on table public.employees to authenticated, service_role;
grant select on table public.site_assignments to authenticated, service_role;

revoke all on function private.set_updated_at() from public, anon, authenticated, service_role;
