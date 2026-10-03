-- Revoke every session of a member's login (lost device, offboarding).
--
-- Deleting auth.sessions cascades to auth.refresh_tokens and
-- auth.mfa_amr_claims, so no session can be refreshed again. Access tokens
-- already issued stay valid until they expire (JWT expiry); RLS does not look
-- sessions up. Sessions belong to the login, not to one organization, so this
-- also ends the user's sessions for any other organization they belong to.
--
-- Scope: owners and admins reach the whole org, managers only members with
-- role 'employee' they can see. Only an owner may sign out an owner.

create function private.sign_out_everywhere(p_employee_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller public.memberships;
  v_organization_id uuid;
  v_user_id uuid;
  v_target_role text;
  v_sessions integer;
begin
  select employee.organization_id, employee.user_id
  into v_organization_id, v_user_id
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_caller := private.require_privileged(v_organization_id);

  if not private.can_see_employee(p_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if v_user_id is null then
    raise exception using errcode = '22023', message = 'employee_has_no_login';
  end if;

  select member.role
  into v_target_role
  from public.memberships as member
  where member.organization_id = v_organization_id
    and member.user_id = v_user_id;

  if (v_caller.role = 'manager' and v_target_role <> 'employee')
    or (v_target_role = 'owner' and v_caller.role <> 'owner')
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  delete from auth.refresh_tokens as token
  where token.user_id = v_user_id::text;

  delete from auth.sessions as session
  where session.user_id = v_user_id;

  get diagnostics v_sessions = row_count;

  perform private.write_audit(
    v_organization_id,
    'member.signed_out_everywhere',
    'employee',
    p_employee_id,
    pg_catalog.jsonb_build_object('user_id', v_user_id, 'sessions_revoked', v_sessions)
  );

  return v_sessions;
end;
$$;

create function public.rpc_sign_out_everywhere(p_employee_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  select private.sign_out_everywhere(p_employee_id);
$$;

comment on function public.rpc_sign_out_everywhere(uuid) is
  'Privileged (fresh MFA): delete every auth session of an employee''s login. Returns the number of sessions revoked.';

revoke all on function private.sign_out_everywhere(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_sign_out_everywhere(uuid) from public, anon, authenticated, service_role;

grant execute on function public.rpc_sign_out_everywhere(uuid) to authenticated;
