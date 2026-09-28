-- GDPR fixes after security review (ADR 007).
--
-- 1. Closed invitations start the retention clock: close_invitation sets
--    left_at, and existing never-joined invitees are backfilled.
-- 2. Offboarding: left_at may not lie before the employee's latest clock
--    event (Brussels day), an already suspended membership is refused
--    (membership_suspended), the kiosk PIN is deleted, and only an owner may
--    offboard or reinstate an admin.
-- 3. Anonymisation locks the auth user row before deciding to delete it, so
--    a concurrent link to another organization cannot race it.
-- 4. Subject and self exports no longer carry chain hashes.
-- 5. run_retention isolates each organization (one failure no longer stops
--    the others; audited as organization.retention_failed with a count only)
--    and purges exports per organization with the org's own today.

-- 1. Invitations ---------------------------------------------------------------------------

create or replace function private.close_invitation(p_invitation public.invitations, p_cause text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update public.invitations as invitation
  set status = 'revoked',
      membership_id = null
  where invitation.id = p_invitation.id;

  if p_invitation.membership_id is not null then
    update public.employees as employee
    set user_id = null
    where employee.organization_id = p_invitation.organization_id
      and employee.id = p_invitation.employee_id
      and employee.user_id = p_invitation.user_id;

    delete from public.memberships as member
    where member.organization_id = p_invitation.organization_id
      and member.id = p_invitation.membership_id
      and member.status = 'invited';
  end if;

  -- The person never joined: out of service from today, so retention covers them.
  update public.employees as employee
  set active = false,
      left_at = coalesce(employee.left_at, private.org_today(employee.organization_id))
  where employee.organization_id = p_invitation.organization_id
    and employee.id = p_invitation.employee_id;

  perform private.write_audit(
    p_invitation.organization_id,
    'member.invitation_revoked',
    'invitation',
    p_invitation.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'employee_id', p_invitation.employee_id,
      'membership_id', p_invitation.membership_id,
      'cause', p_cause
    ))
  );
end;
$$;

-- Inactive employees without a last day were closed invitations: their last
-- day is when the invitation was closed (or today, if unknown).
update public.employees as employee
set left_at = coalesce(
  (
    select (pg_catalog.max(invitation.updated_at) at time zone organization.timezone)::date
    from public.invitations as invitation
    where invitation.organization_id = employee.organization_id
      and invitation.employee_id = employee.id
      and invitation.status = 'revoked'
  ),
  private.org_today(employee.organization_id)
)
from public.organizations as organization
where organization.id = employee.organization_id
  and not employee.active
  and employee.left_at is null
  and employee.anonymised_at is null;

-- 2. Offboarding ----------------------------------------------------------------------------

create or replace function private.require_offboard_scope(p_employee public.employees)
returns public.memberships
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_caller public.memberships;
  v_target public.memberships;
begin
  v_caller := private.require_privileged(p_employee.organization_id);

  if not private.can_see_employee(p_employee.id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_employee.user_id is not null then
    if p_employee.user_id = (select auth.uid()) then
      raise exception using errcode = '42501', message = 'cannot_offboard_self';
    end if;

    select member.*
    into v_target
    from public.memberships as member
    where member.organization_id = p_employee.organization_id
      and member.user_id = p_employee.user_id;

    -- An owner leaves only after ownership moved; admins only by an owner;
    -- managers handle employees only.
    if v_target.role = 'owner' then
      raise exception using errcode = '42501', message = 'cannot_offboard_owner';
    end if;
    if v_target.role = 'admin' and v_caller.role <> 'owner' then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
    if v_caller.role = 'manager' and v_target.role <> 'employee' then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
  end if;

  return v_target;
end;
$$;

create or replace function private.offboard_employee(p_employee_id uuid, p_left_at date default null)
returns date
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_target public.memberships;
  v_today date;
  v_left_at date;
  v_last_event date;
  v_pins integer;
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_target := private.require_offboard_scope(v_employee);

  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id
  for update;

  if v_employee.left_at is not null or v_employee.anonymised_at is not null then
    raise exception using errcode = '55000', message = 'already_left';
  end if;

  -- Reinstating would lift a suspension that offboarding did not set.
  if v_target.id is not null and v_target.status = 'suspended' then
    raise exception using errcode = '55000', message = 'membership_suspended';
  end if;

  v_today := private.org_today(v_employee.organization_id);
  v_left_at := coalesce(p_left_at, v_today);
  if v_left_at > v_today or v_left_at < v_today - 366 then
    raise exception using errcode = '22023', message = 'invalid_left_at';
  end if;

  -- The retention clock may never start before the person's own last fact.
  select (pg_catalog.max(event.occurred_at) at time zone organization.timezone)::date
  into v_last_event
  from public.clock_events as event
  join public.organizations as organization on organization.id = event.organization_id
  where event.organization_id = v_employee.organization_id
    and event.employee_id = v_employee.id
  group by organization.timezone;

  if v_left_at < v_last_event then
    raise exception using errcode = '22023', message = 'left_at_before_last_event';
  end if;

  update public.employees as employee
  set left_at = v_left_at,
      active = false
  where employee.id = v_employee.id;

  if v_target.id is not null then
    update public.memberships as member
    set status = 'suspended'
    where member.id = v_target.id;
  end if;

  -- A kiosk PIN outlives nothing: reinstating needs a new one.
  delete from public.employee_pins as pin
  where pin.organization_id = v_employee.organization_id
    and pin.employee_id = v_employee.id;
  get diagnostics v_pins = row_count;

  perform private.write_audit(
    v_employee.organization_id,
    'employee.offboarded',
    'employee',
    v_employee.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'left_at', v_left_at,
      'membership_id', v_target.id,
      'previous_status', v_target.status,
      'pin_deleted', v_pins > 0
    ))
  );

  -- Same checks and its own audit row; ends every session of the login.
  if v_employee.user_id is not null then
    perform private.sign_out_everywhere(v_employee.id);
  end if;

  return v_left_at;
end;
$$;

-- 3. Anonymisation --------------------------------------------------------------------------

create or replace function private.anonymise_employee(p_employee_id uuid, p_cutoff date)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_timezone text;
  v_floor date;
  v_user_id uuid;
  v_membership_id uuid;
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id
  for update;

  if not found or p_cutoff is null then
    return false;
  end if;

  -- Hard floor: never within 5 years, whatever the caller passed.
  v_floor := (private.org_today(v_employee.organization_id) - interval '5 years')::date;
  if p_cutoff > v_floor then
    return false;
  end if;

  if v_employee.anonymised_at is not null
    or v_employee.active
    or v_employee.left_at is null
    or v_employee.left_at >= p_cutoff
  then
    return false;
  end if;

  select organization.timezone
  into v_timezone
  from public.organizations as organization
  where organization.id = v_employee.organization_id;

  if private.has_facts_since(
    v_employee.organization_id,
    v_employee.id,
    p_cutoff::timestamp at time zone v_timezone
  ) then
    return false;
  end if;

  v_user_id := v_employee.user_id;

  update public.employees as employee
  set display_name = 'Voormalig medewerker '
        || pg_catalog.encode(extensions.gen_random_bytes(3), 'hex'),
      employee_code = null,
      user_id = null,
      anonymised_at = pg_catalog.clock_timestamp()
  where employee.id = v_employee.id;

  perform pg_catalog.set_config('cloxa.anonymising', 'on', true);
  update public.correction_requests as request
  set reason = null,
      decision_note = null
  where request.organization_id = v_employee.organization_id
    and request.employee_id = v_employee.id
    and (request.reason is not null or request.decision_note is not null);
  perform pg_catalog.set_config('cloxa.anonymising', '', true);

  delete from public.employee_pins as pin
  where pin.organization_id = v_employee.organization_id
    and pin.employee_id = v_employee.id;

  update public.invitations as invitation
  set status = 'anonymised',
      email = invitation.id::text || '@anoniem.invalid',
      user_id = null,
      membership_id = null
  where invitation.organization_id = v_employee.organization_id
    and invitation.employee_id = v_employee.id;

  if v_user_id is not null then
    -- Serialises with a concurrent membership insert for this login (its
    -- foreign key check takes a share lock on the same row).
    perform 1
    from auth.users as auth_user
    where auth_user.id = v_user_id
    for update;

    select member.id
    into v_membership_id
    from public.memberships as member
    where member.organization_id = v_employee.organization_id
      and member.user_id = v_user_id;

    delete from public.memberships as member
    where member.id = v_membership_id;

    if not exists (select 1 from public.memberships as member where member.user_id = v_user_id) then
      update public.invitations as invitation
      set user_id = null
      where invitation.user_id = v_user_id
        and invitation.status in ('revoked', 'anonymised');

      delete from auth.users as auth_user
      where auth_user.id = v_user_id;
    end if;
  end if;

  return true;
end;
$$;

-- 4. Exports without hashes -----------------------------------------------------------------

create or replace function private.subject_document(p_employee_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_membership_ids uuid[];
  v_correction_ids uuid[];
  v_invitation_ids uuid[];
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  select coalesce(pg_catalog.array_agg(member.id), '{}')
  into v_membership_ids
  from public.memberships as member
  where member.organization_id = v_employee.organization_id
    and member.user_id = v_employee.user_id;

  select coalesce(pg_catalog.array_agg(request.id), '{}')
  into v_correction_ids
  from public.correction_requests as request
  where request.organization_id = v_employee.organization_id
    and request.employee_id = v_employee.id;

  select coalesce(pg_catalog.array_agg(invitation.id), '{}')
  into v_invitation_ids
  from public.invitations as invitation
  where invitation.organization_id = v_employee.organization_id
    and invitation.employee_id = v_employee.id;

  return pg_catalog.jsonb_build_object(
    'format', 'cloxa.subject_export.v1',
    'generated_at', pg_catalog.clock_timestamp(),
    'organization', (
      select pg_catalog.jsonb_build_object('id', organization.id, 'name', organization.name)
      from public.organizations as organization
      where organization.id = v_employee.organization_id
    ),
    'employee', pg_catalog.jsonb_build_object(
      'id', v_employee.id,
      'user_id', v_employee.user_id,
      'display_name', v_employee.display_name,
      'employee_code', v_employee.employee_code,
      'statute', v_employee.statute,
      'language', v_employee.language,
      'active', v_employee.active,
      'left_at', v_employee.left_at,
      'anonymised_at', v_employee.anonymised_at,
      'created_at', v_employee.created_at,
      'updated_at', v_employee.updated_at
    ),
    'memberships', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', member.id, 'role', member.role, 'status', member.status,
        'created_at', member.created_at, 'updated_at', member.updated_at
      ) order by member.created_at)
      from public.memberships as member
      where member.id = any (v_membership_ids)
    ), '[]'::jsonb),
    'site_assignments', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'site_id', assignment.site_id,
        'site_name', site.name,
        'as', case when assignment.employee_id is not null then 'employee' else 'manager' end,
        'created_at', assignment.created_at
      ) order by assignment.created_at)
      from public.site_assignments as assignment
      join public.sites as site
        on site.organization_id = assignment.organization_id
       and site.id = assignment.site_id
      where assignment.organization_id = v_employee.organization_id
        and (assignment.employee_id = v_employee.id or assignment.membership_id = any (v_membership_ids))
    ), '[]'::jsonb),
    'schedules', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', schedule.id, 'version', schedule.version, 'valid_from', schedule.valid_from,
        'pattern', schedule.pattern, 'notified_at', schedule.notified_at,
        'created_by', schedule.created_by, 'created_at', schedule.created_at
      ) order by schedule.version)
      from public.schedules as schedule
      where schedule.organization_id = v_employee.organization_id
        and schedule.employee_id = v_employee.id
    ), '[]'::jsonb),
    'clock_events', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', event.id, 'site_id', event.site_id, 'type', event.type,
        'occurred_at', event.occurred_at, 'server_at', event.server_at,
        'client_captured_at', event.client_captured_at, 'source', event.source,
        'offline', event.offline, 'device_id', event.device_id, 'geo', event.geo,
        'supersedes_event_id', event.supersedes_event_id, 'correction_id', event.correction_id,
        'actor_user_id', event.actor_user_id,
        'effective', not exists (
          select 1
          from public.clock_events as later
          where later.supersedes_event_id = event.id
        )
      ) order by event.occurred_at, event.server_at)
      from public.clock_events as event
      where event.organization_id = v_employee.organization_id
        and event.employee_id = v_employee.id
    ), '[]'::jsonb),
    'correction_requests', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', request.id, 'kind', request.kind, 'status', request.status,
        'target_event_ids', pg_catalog.to_jsonb(request.target_event_ids),
        'proposed', request.proposed, 'reason', request.reason,
        'requested_by', request.requested_by, 'created_at', request.created_at,
        'decided_by', request.decided_by, 'decided_at', request.decided_at,
        'decision_note', request.decision_note, 'offline', request.offline,
        'offline_reason', request.offline_reason
      ) order by request.created_at)
      from public.correction_requests as request
      where request.id = any (v_correction_ids)
    ), '[]'::jsonb),
    'invitations', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', invitation.id, 'email', invitation.email, 'role', invitation.role,
        'status', invitation.status, 'invited_by', invitation.invited_by,
        'created_at', invitation.created_at, 'expires_at', invitation.expires_at
      ) order by invitation.created_at)
      from public.invitations as invitation
      where invitation.id = any (v_invitation_ids)
    ), '[]'::jsonb),
    'pin', (
      select pg_catalog.jsonb_build_object('set_at', pin.set_at, 'set_by', pin.set_by)
      from public.employee_pins as pin
      where pin.organization_id = v_employee.organization_id
        and pin.employee_id = v_employee.id
    ),
    'audit_log', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', log.id, 'created_at', log.created_at, 'actor_user_id', log.actor_user_id,
        'action', log.action, 'entity', log.entity, 'entity_id', log.entity_id,
        'metadata', log.metadata
      ) order by log.created_at)
      from public.audit_log as log
      where log.organization_id = v_employee.organization_id
        and (
          (v_employee.user_id is not null and log.actor_user_id = v_employee.user_id)
          or log.entity_id = v_employee.id
          or log.entity_id = any (v_membership_ids)
          or log.entity_id = any (v_correction_ids)
          or log.entity_id = any (v_invitation_ids)
          or log.metadata ->> 'employee_id' = v_employee.id::text
        )
    ), '[]'::jsonb)
  );
end;
$$;

-- 5. Retention job --------------------------------------------------------------------------

-- Deletes one organization's exports whose period ended before p_cutoff, never
-- within its retention (at least 5 years before the org's today). Audited
-- as export.purged when anything went.
create function private.purge_org_exports(p_organization_id uuid, p_cutoff date)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cutoff date;
  v_count integer;
begin
  v_cutoff := least(
    p_cutoff,
    (private.org_today(p_organization_id)
      - pg_catalog.make_interval(years => private.retention_years(p_organization_id)))::date
  );
  if v_cutoff is null then
    return 0;
  end if;

  perform pg_catalog.set_config('cloxa.purging_exports', 'on', true);
  delete from public.exports as stored
  where stored.organization_id = p_organization_id
    and stored.period_to < v_cutoff;
  get diagnostics v_count = row_count;
  perform pg_catalog.set_config('cloxa.purging_exports', '', true);

  if v_count > 0 then
    perform private.write_audit(
      p_organization_id,
      'export.purged',
      'organization',
      p_organization_id,
      pg_catalog.jsonb_build_object('before', v_cutoff, 'count', v_count)
    );
  end if;

  return v_count;
end;
$$;

create or replace function private.run_retention()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_employee record;
  v_cutoff date;
  v_anonymised integer;
  v_exports integer;
  v_total_anonymised integer := 0;
  v_total_exports integer := 0;
  v_failed integer := 0;
begin
  for v_org in
    select organization.id
    from public.organizations as organization
    order by organization.id
  loop
    -- One organization's failure is rolled back on its own and never stops the others.
    begin
      v_cutoff := (private.org_today(v_org.id)
        - pg_catalog.make_interval(years => private.retention_years(v_org.id)))::date;
      v_anonymised := 0;

      for v_employee in
        select employee.id
        from public.employees as employee
        where employee.organization_id = v_org.id
          and employee.anonymised_at is null
          and not employee.active
          and employee.left_at < v_cutoff
        order by employee.id
      loop
        if private.anonymise_employee(v_employee.id, v_cutoff) then
          v_anonymised := v_anonymised + 1;
        end if;
      end loop;

      v_exports := private.purge_org_exports(v_org.id, v_cutoff);

      if v_anonymised > 0 or v_exports > 0 then
        perform private.write_audit(
          v_org.id,
          'organization.retention_applied',
          'organization',
          v_org.id,
          pg_catalog.jsonb_build_object(
            'employees_anonymised', v_anonymised,
            'exports_purged', v_exports,
            'cutoff', v_cutoff
          )
        );
      end if;

      v_total_anonymised := v_total_anonymised + v_anonymised;
      v_total_exports := v_total_exports + v_exports;
    exception when others then
      v_failed := v_failed + 1;
      -- The SQLSTATE only: messages can quote row values.
      raise warning 'run_retention: organization % failed (SQLSTATE %)', v_org.id, sqlstate;
      begin
        perform private.write_audit(
          v_org.id,
          'organization.retention_failed',
          'organization',
          v_org.id,
          pg_catalog.jsonb_build_object('errors', 1)
        );
      exception when others then
        raise warning 'run_retention: could not audit the failure for organization %', v_org.id;
      end;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'employees_anonymised', v_total_anonymised,
    'exports_purged', v_total_exports,
    'organizations_failed', v_failed
  );
end;
$$;

revoke all on function private.purge_org_exports(uuid, date) from public, anon, authenticated, service_role;
