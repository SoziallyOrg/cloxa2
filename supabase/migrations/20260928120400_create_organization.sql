-- Admin bootstrap for onboarding: an organization with a default site and an
-- owner who is both an active member and a clocking employee at that site.
-- Executable only by service_role (server-side onboarding), never by users.

create function private.create_organization(
  p_name text,
  p_owner_user_id uuid,
  p_owner_display_name text default null
)
returns table (
  organization_id uuid,
  site_id uuid,
  membership_id uuid,
  employee_id uuid
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_display_name text;
  v_organization_id uuid;
  v_site_id uuid;
  v_membership_id uuid;
  v_employee_id uuid;
begin
  if p_name is null or pg_catalog.btrim(p_name) = '' or p_owner_user_id is null then
    raise exception using errcode = '22023', message = 'invalid_input';
  end if;

  select auth_user.email
  into v_email
  from auth.users as auth_user
  where auth_user.id = p_owner_user_id
    and auth_user.deleted_at is null;

  if not found then
    raise exception using errcode = '22023', message = 'owner_not_found';
  end if;

  v_display_name := coalesce(
    nullif(pg_catalog.btrim(p_owner_display_name), ''),
    nullif(pg_catalog.split_part(coalesce(v_email, ''), '@', 1), ''),
    'owner'
  );

  insert into public.organizations (name)
  values (pg_catalog.btrim(p_name))
  returning id into v_organization_id;

  insert into public.sites (organization_id, name)
  values (v_organization_id, pg_catalog.btrim(p_name))
  returning id into v_site_id;

  insert into public.memberships (organization_id, user_id, role, status)
  values (v_organization_id, p_owner_user_id, 'owner', 'active')
  returning id into v_membership_id;

  insert into public.employees (organization_id, user_id, display_name)
  values (v_organization_id, p_owner_user_id, v_display_name)
  returning id into v_employee_id;

  insert into public.site_assignments (organization_id, site_id, employee_id)
  values (v_organization_id, v_site_id, v_employee_id);

  perform private.write_audit(
    v_organization_id,
    'organization.created',
    'organization',
    v_organization_id,
    pg_catalog.jsonb_build_object(
      'site_id', v_site_id,
      'membership_id', v_membership_id,
      'employee_id', v_employee_id,
      'owner_user_id', p_owner_user_id
    )
  );

  return query select v_organization_id, v_site_id, v_membership_id, v_employee_id;
end;
$$;

comment on function private.create_organization(text, uuid, text) is
  'Service-role bootstrap: organization, default site, owner membership and employee row. Audited.';

revoke all on function private.create_organization(text, uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function private.create_organization(text, uuid, text) to service_role;
