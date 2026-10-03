-- Privileged-access helpers and tenancy RLS policies.
--
-- Identity is auth.uid() plus membership rows, never client input or user
-- metadata. Privileged roles (owner, admin, manager) only count as privileged
-- with fresh MFA (private.has_fresh_mfa), so a manager signed in with just an
-- email code gets employee-level (self-only) visibility.
--
-- The helpers are SECURITY DEFINER so they can read memberships without
-- recursing into the memberships policy. Each one is a single indexed probe:
-- memberships (organization_id, user_id) is unique, employees and
-- site_assignments are reached by primary key or partial (subject, site) index.

-- Fresh MFA: aal2 AND an amr entry for a second factor (totp or webauthn)
-- whose timestamp lies within the last 12 hours (the absolute privileged
-- session limit from ADR 002). Anything missing or malformed fails closed.
-- The 30-minute idle timeout stays in app code: the database cannot observe
-- idleness, only when the factor was last verified.
create function private.has_fresh_mfa()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'
    and exists (
      select 1
      from pg_catalog.jsonb_array_elements(
        case
          when pg_catalog.jsonb_typeof((select auth.jwt()) -> 'amr') = 'array'
            then (select auth.jwt()) -> 'amr'
          else '[]'::jsonb
        end
      ) as amr (entry)
      where case
        when pg_catalog.jsonb_typeof(amr.entry) <> 'object' then false
        when pg_catalog.jsonb_typeof(amr.entry -> 'timestamp') is distinct from 'number' then false
        else amr.entry ->> 'method' in ('totp', 'webauthn')
          and (amr.entry -> 'timestamp')::numeric
            between extract(epoch from pg_catalog.now()) - 12 * 3600
                and extract(epoch from pg_catalog.now()) + 300
      end
    );
$$;

comment on function private.has_fresh_mfa() is
  'True only for aal2 JWTs whose totp/webauthn amr entry is at most 12 hours old.';

create function private.current_membership(p_organization_id uuid)
returns public.memberships
language sql
stable
security definer
set search_path = ''
as $$
  select membership.*
  from public.memberships as membership
  where membership.organization_id = p_organization_id
    and membership.user_id = (select auth.uid())
    and membership.status = 'active';
$$;

comment on function private.current_membership(uuid) is
  'Active membership of the caller in the organization, or a null row.';

create function private.is_privileged(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.has_fresh_mfa()
    and exists (
      select 1
      from public.memberships as membership
      where membership.organization_id = p_organization_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
        and membership.role in ('owner', 'admin', 'manager')
    );
$$;

comment on function private.is_privileged(uuid) is
  'True when the caller is an active owner/admin/manager of the organization with fresh MFA.';

create function private.require_privileged(p_organization_id uuid)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships;
begin
  if not private.is_privileged(p_organization_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_membership := private.current_membership(p_organization_id);
  return v_membership;
end;
$$;

comment on function private.require_privileged(uuid) is
  'Raises 42501 unless private.is_privileged(org); returns the caller membership.';

create function private.can_see_employee(p_employee_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees as employee
    join public.memberships as membership
      on membership.organization_id = employee.organization_id
     and membership.user_id = (select auth.uid())
     and membership.status = 'active'
    where employee.id = p_employee_id
      and (
        -- Self: no privilege needed.
        employee.user_id = membership.user_id
        or (
          private.has_fresh_mfa()
          and (
            membership.role in ('owner', 'admin')
            or (
              membership.role = 'manager'
              and exists (
                select 1
                from public.site_assignments as managed
                join public.site_assignments as assigned
                  on assigned.site_id = managed.site_id
                 and assigned.organization_id = managed.organization_id
                where managed.membership_id = membership.id
                  and assigned.employee_id = employee.id
              )
            )
          )
        )
      )
  );
$$;

comment on function private.can_see_employee(uuid) is
  'Employee: self. Manager (fresh MFA): employees on a managed site. Admin/owner (fresh MFA): whole org.';

revoke all on function private.has_fresh_mfa() from public, anon, authenticated, service_role;
revoke all on function private.current_membership(uuid) from public, anon, authenticated, service_role;
revoke all on function private.is_privileged(uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_privileged(uuid) from public, anon, authenticated, service_role;
revoke all on function private.can_see_employee(uuid) from public, anon, authenticated, service_role;

-- Only what RLS policies need. require_privileged is for RPC bodies only.
grant execute on function private.current_membership(uuid) to authenticated;
grant execute on function private.is_privileged(uuid) to authenticated;
grant execute on function private.can_see_employee(uuid) to authenticated;

create policy organizations_select_member
on public.organizations
for select
to authenticated
using ((private.current_membership(id)).id is not null);

create policy sites_select_member
on public.sites
for select
to authenticated
using ((private.current_membership(organization_id)).id is not null);

create policy memberships_select_own_or_org_admin
on public.memberships
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (
    private.is_privileged(organization_id)
    and (private.current_membership(organization_id)).role in ('owner', 'admin')
  )
);

create policy employees_select_visible
on public.employees
for select
to authenticated
using (private.can_see_employee(id));

create policy site_assignments_select_visible
on public.site_assignments
for select
to authenticated
using (
  (employee_id is not null and private.can_see_employee(employee_id))
  or (
    membership_id is not null
    and membership_id = (private.current_membership(organization_id)).id
  )
  or (
    private.is_privileged(organization_id)
    and (private.current_membership(organization_id)).role in ('owner', 'admin')
  )
);
