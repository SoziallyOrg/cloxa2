-- GDPR: offboarding, retention (anonymisation) and data-subject access (ADR 007).
--
-- Keep facts, remove identity. clock_events and audit_log hold only UUIDs
-- (never names, emails or free text), so their hash chains keep verifying
-- after a person is anonymised; no fact row is ever deleted.
--
-- 1. employees.left_at / anonymised_at. "Uit dienst" (rpc_offboard_employee)
--    sets left_at, suspends the membership, signs the login out everywhere
--    and deactivates the employee; rpc_reinstate_employee reverses it until
--    the person is anonymised.
-- 2. private.anonymise_employee: once left_at + retention (org setting, never
--    less than 5 years) has passed and no fact of theirs is that recent, the
--    name and code, free-text correction reasons and notes, the PIN, the
--    invitation email and the login link go. The auth user is deleted when it
--    has no membership left anywhere.
-- 3. private.run_retention (no role may execute it): anonymisation plus
--    private.purge_exports for every org, one audit row per org with counts.
--    Scheduled daily with pg_cron when the extension is available.
-- 4. rpc_subject_export (owner/admin, fresh MFA) and rpc_my_data_export (self):
--    one JSON document with everything about the person. Both audited.
-- 5. rpc_update_org_settings (owner/admin, fresh MFA): retention_years (5-10),
--    offline_clocking, offline_max_skew_minutes, correction_max_age_days.

-- 1. Columns ----------------------------------------------------------------------------------

alter table public.employees
  add column left_at date,
  add column anonymised_at timestamptz;

alter table public.employees
  add constraint employees_left_check check (left_at is null or not active),
  add constraint employees_anonymised_check check (
    anonymised_at is null
    or (left_at is not null and not active and user_id is null and employee_code is null)
  );

comment on column public.employees.left_at is
  'Last day in service ("Uit dienst"). Starts the retention clock (ADR 007).';
comment on column public.employees.anonymised_at is
  'When retention removed this person''s identity. Facts stay, identity is gone (ADR 007).';

-- Anonymisation clears the free text of a person's correction requests.
alter table public.correction_requests alter column reason drop not null;
alter table public.correction_requests drop constraint correction_requests_reason_check;
alter table public.correction_requests
  add constraint correction_requests_reason_check
    check (reason is null or (btrim(reason) <> '' and char_length(reason) <= 280));

comment on column public.correction_requests.reason is
  'Free text for the decider only; null once the requester is anonymised (ADR 007).';

-- An anonymised invitation keeps its role and dates, not the email or login.
alter table public.invitations drop constraint invitations_status_check;
alter table public.invitations
  add constraint invitations_status_check
    check (status in ('pending', 'linked', 'accepted', 'revoked', 'anonymised'));

alter table public.invitations drop constraint invitations_link_check;
alter table public.invitations
  add constraint invitations_link_check check (
    case status
      when 'pending' then user_id is null and membership_id is null
      when 'revoked' then membership_id is null
      when 'anonymised' then user_id is null and membership_id is null
      else membership_id is not null
    end
  );

-- Only the decision of a pending request may change, exactly once. The one
-- exception is anonymisation (transaction-local flag, set only inside
-- private.anonymise_employee): it may clear reason and decision_note and
-- nothing else. API roles hold no UPDATE grant, so only definer code gets here.
create or replace function private.correction_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(pg_catalog.current_setting('cloxa.anonymising', true), '') = 'on'
    and new.reason is null
    and new.decision_note is null
    and (new.id, new.organization_id, new.employee_id, new.requested_by, new.kind, new.target_event_ids,
         new.proposed, new.status, new.created_at, new.decided_by, new.decided_at, new.offline,
         new.idempotency_key, new.offline_reason)
      is not distinct from
        (old.id, old.organization_id, old.employee_id, old.requested_by, old.kind, old.target_event_ids,
         old.proposed, old.status, old.created_at, old.decided_by, old.decided_at, old.offline,
         old.idempotency_key, old.offline_reason)
  then
    return new;
  end if;

  if old.status <> 'pending' then
    raise exception using errcode = '55000', message = 'correction_requests is immutable after decision';
  end if;

  if new.status = 'pending'
    or (new.id, new.organization_id, new.employee_id, new.requested_by, new.kind, new.target_event_ids,
        new.proposed, new.reason, new.created_at, new.offline, new.idempotency_key, new.offline_reason)
      is distinct from
       (old.id, old.organization_id, old.employee_id, old.requested_by, old.kind, old.target_event_ids,
        old.proposed, old.reason, old.created_at, old.offline, old.idempotency_key, old.offline_reason)
  then
    raise exception using errcode = '55000', message = 'only the decision of a correction request may change';
  end if;

  return new;
end;
$$;

-- Helpers ---------------------------------------------------------------------------------

-- Today in the organization's timezone.
create function private.org_today(p_organization_id uuid)
returns date
language sql
stable
set search_path = ''
as $$
  select (pg_catalog.clock_timestamp() at time zone organization.timezone)::date
  from public.organizations as organization
  where organization.id = p_organization_id;
$$;

-- Retention in years: the org setting, but never below the legal 5 years,
-- whatever a setting (or a future bug) says.
create function private.retention_years(p_organization_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce(
      (
        select case
          when pg_catalog.jsonb_typeof(organization.settings -> 'retention_years') = 'number'
            then pg_catalog.floor((organization.settings -> 'retention_years')::numeric)::integer
        end
        from public.organizations as organization
        where organization.id = p_organization_id
      ),
      5
    ),
    5
  );
$$;

-- 1. Offboarding ------------------------------------------------------------------------------

-- Shared scope rules for offboarding and reinstating. Returns the target's
-- membership (a null row for a worker without a login).
create function private.require_offboard_scope(p_employee public.employees)
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

    -- An owner leaves only after ownership moved; managers handle employees only.
    if v_target.role = 'owner' then
      raise exception using errcode = '42501', message = 'cannot_offboard_owner';
    end if;
    if v_caller.role = 'manager' and v_target.role <> 'employee' then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
  end if;

  return v_target;
end;
$$;

create function private.offboard_employee(p_employee_id uuid, p_left_at date default null)
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

  v_today := private.org_today(v_employee.organization_id);
  v_left_at := coalesce(p_left_at, v_today);
  if v_left_at > v_today or v_left_at < v_today - 366 then
    raise exception using errcode = '22023', message = 'invalid_left_at';
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

  perform private.write_audit(
    v_employee.organization_id,
    'employee.offboarded',
    'employee',
    v_employee.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'left_at', v_left_at,
      'membership_id', v_target.id,
      'previous_status', v_target.status
    ))
  );

  -- Same checks and its own audit row; ends every session of the login.
  if v_employee.user_id is not null then
    perform private.sign_out_everywhere(v_employee.id);
  end if;

  return v_left_at;
end;
$$;

create function private.reinstate_employee(p_employee_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_target public.memberships;
  v_status text;
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

  if v_employee.anonymised_at is not null then
    raise exception using errcode = '55000', message = 'employee_anonymised';
  end if;
  if v_employee.left_at is null then
    raise exception using errcode = '55000', message = 'not_left';
  end if;

  update public.employees as employee
  set left_at = null,
      active = true
  where employee.id = v_employee.id;

  if v_target.id is not null and v_target.status = 'suspended' then
    -- Back to where they were: active, unless the invitation was never accepted.
    v_status := case
      when exists (
        select 1
        from public.invitations as invitation
        where invitation.organization_id = v_target.organization_id
          and invitation.membership_id = v_target.id
          and invitation.status = 'linked'
      ) then 'invited'
      else 'active'
    end;

    update public.memberships as member
    set status = v_status
    where member.id = v_target.id;
  end if;

  perform private.write_audit(
    v_employee.organization_id,
    'employee.reinstated',
    'employee',
    v_employee.id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'membership_id', v_target.id,
      'status', v_status
    ))
  );
end;
$$;

create function public.rpc_offboard_employee(p_employee_id uuid, p_left_at date default null)
returns date
language sql
volatile
security definer
set search_path = ''
as $$
  select private.offboard_employee(p_employee_id, p_left_at);
$$;

comment on function public.rpc_offboard_employee(uuid, date) is
  'Privileged (fresh MFA): "Uit dienst". Sets left_at (default today), suspends the membership, signs out everywhere, deactivates.';

create function public.rpc_reinstate_employee(p_employee_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.reinstate_employee(p_employee_id);
$$;

comment on function public.rpc_reinstate_employee(uuid) is
  'Privileged (fresh MFA): "Terug in dienst". Reverses an offboarding unless the person was anonymised.';

-- 2. Anonymisation ----------------------------------------------------------------------------

-- True when any fact of the employee is dated on or after p_since: the time
-- a clock event refers to (a late correction of an old event also leaves a
-- recent request), a correction request's creation or decision, a schedule
-- version's start or publication.
create function private.has_facts_since(p_organization_id uuid, p_employee_id uuid, p_since timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
      select 1
      from public.clock_events as event
      where event.organization_id = p_organization_id
        and event.employee_id = p_employee_id
        and event.occurred_at >= p_since
    )
    or exists (
      select 1
      from public.correction_requests as request
      where request.organization_id = p_organization_id
        and request.employee_id = p_employee_id
        and (request.created_at >= p_since or request.decided_at >= p_since)
    )
    or exists (
      select 1
      from public.schedules as schedule
      where schedule.organization_id = p_organization_id
        and schedule.employee_id = p_employee_id
        and (schedule.created_at >= p_since or schedule.valid_from >= (p_since at time zone 'UTC')::date)
    );
$$;

-- Anonymises one departed employee when retention allows it; false otherwise.
-- p_cutoff: the org's today minus its retention (at least 5 years). Every
-- condition is re-checked under the row lock, so a concurrent reinstatement
-- or a late fact always wins.
create function private.anonymise_employee(p_employee_id uuid, p_cutoff date)
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

  -- Identity on the employee row.
  update public.employees as employee
  set display_name = 'Voormalig medewerker '
        || pg_catalog.encode(extensions.gen_random_bytes(3), 'hex'),
      employee_code = null,
      user_id = null,
      anonymised_at = pg_catalog.clock_timestamp()
  where employee.id = v_employee.id;

  -- Free text of their correction requests.
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

  -- Invitations for this employee: no email, no login link.
  update public.invitations as invitation
  set status = 'anonymised',
      email = invitation.id::text || '@anoniem.invalid',
      user_id = null,
      membership_id = null
  where invitation.organization_id = v_employee.organization_id
    and invitation.employee_id = v_employee.id;

  if v_user_id is not null then
    select member.id
    into v_membership_id
    from public.memberships as member
    where member.organization_id = v_employee.organization_id
      and member.user_id = v_user_id;

    -- Site assignments of the membership cascade.
    delete from public.memberships as member
    where member.id = v_membership_id;

    if not exists (select 1 from public.memberships as member where member.user_id = v_user_id) then
      -- Old closed invitations elsewhere still point at the login.
      update public.invitations as invitation
      set user_id = null
      where invitation.user_id = v_user_id
        and invitation.status in ('revoked', 'anonymised');

      -- Cascades to identities, sessions, refresh tokens and MFA factors.
      delete from auth.users as auth_user
      where auth_user.id = v_user_id;
    end if;
  end if;

  return true;
end;
$$;

comment on function private.anonymise_employee(uuid, date) is
  'Retention: removes a departed employee''s identity when left_at and every fact are older than p_cutoff (never within 5 years). Granted to no role.';

-- 3. The retention job ------------------------------------------------------------------------

create function private.run_retention()
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
  v_export_cutoff date;
  v_anonymised integer;
  v_exports integer;
  v_total_anonymised integer := 0;
  v_total_exports integer;
  -- purge_exports never goes further back than this (and than the org setting).
  v_export_floor date := (current_date - interval '5 years')::date;
begin
  for v_org in
    select organization.id, organization.settings
    from public.organizations as organization
    order by organization.id
  loop
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

    -- Same cutoff as private.purge_exports computes for this org below.
    v_export_cutoff := least(
      v_export_floor,
      (current_date
        - pg_catalog.make_interval(years => (v_org.settings ->> 'retention_years')::numeric::integer))::date
    );
    select pg_catalog.count(*)::integer
    into v_exports
    from public.exports as stored
    where stored.organization_id = v_org.id
      and stored.period_to < v_export_cutoff;

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
  end loop;

  v_total_exports := private.purge_exports(v_export_floor);

  return pg_catalog.jsonb_build_object(
    'employees_anonymised', v_total_anonymised,
    'exports_purged', v_total_exports
  );
end;
$$;

comment on function private.run_retention() is
  'Daily retention job (pg_cron): anonymise departed employees past retention, purge old exports. Granted to no role.';

-- 4. Data-subject access ----------------------------------------------------------------------

-- Everything about one employee in their organization, as one JSON document.
-- No authorization here: the RPCs below decide who may call it.
create function private.subject_document(p_employee_id uuid)
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
        ),
        'hash', pg_catalog.encode(event.hash, 'hex')
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
    -- Whether and when a PIN was set; never the hash.
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

-- Owner or admin with fresh MFA: the full document for one person in their org.
create function private.subject_export(p_employee_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_caller public.memberships;
begin
  select employee.organization_id
  into v_organization_id
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_caller := private.require_privileged(v_organization_id);
  if v_caller.role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- Audited first: a download that fails afterwards is still on record.
  perform private.write_audit(
    v_organization_id,
    'employee.subject_exported',
    'employee',
    p_employee_id,
    '{}'::jsonb
  );

  return private.subject_document(p_employee_id);
end;
$$;

-- The caller's own data, in every organization where they are an active member.
create function private.my_data_export()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_row record;
  v_documents jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  for v_row in
    select employee.id, employee.organization_id
    from public.employees as employee
    join public.memberships as member
      on member.organization_id = employee.organization_id
     and member.user_id = employee.user_id
    where employee.user_id = v_user_id
      and member.status = 'active'
    order by employee.organization_id
  loop
    perform private.write_audit(
      v_row.organization_id,
      'employee.self_data_exported',
      'employee',
      v_row.id,
      '{}'::jsonb
    );
    v_documents := v_documents || pg_catalog.jsonb_build_array(private.subject_document(v_row.id));
  end loop;

  if pg_catalog.jsonb_array_length(v_documents) = 0 then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  return pg_catalog.jsonb_build_object(
    'format', 'cloxa.my_data_export.v1',
    'generated_at', pg_catalog.clock_timestamp(),
    'user_id', v_user_id,
    'organizations', v_documents
  );
end;
$$;

create function public.rpc_subject_export(p_employee_id uuid)
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.subject_export(p_employee_id);
$$;

comment on function public.rpc_subject_export(uuid) is
  'Owner/admin (fresh MFA): data-subject access (AVG art. 15) export of one person in the org. Audited.';

create function public.rpc_my_data_export()
returns jsonb
language sql
volatile
security definer
set search_path = ''
as $$
  select private.my_data_export();
$$;

comment on function public.rpc_my_data_export() is
  'Self: everything about the caller in each organization where they are an active member. Audited per org.';

-- 5. Org settings -----------------------------------------------------------------------------

create function private.update_org_settings(
  p_org uuid,
  p_retention_years integer,
  p_offline_clocking boolean,
  p_offline_max_skew_minutes integer,
  p_correction_max_age_days integer
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_caller public.memberships;
  v_values jsonb;
begin
  v_caller := private.require_privileged(p_org);
  if v_caller.role not in ('owner', 'admin') then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_retention_years is null or p_retention_years not between 5 and 10 then
    raise exception using errcode = '22023', message = 'invalid_retention_years';
  end if;
  if p_offline_clocking is null then
    raise exception using errcode = '22023', message = 'invalid_offline_clocking';
  end if;
  if p_offline_max_skew_minutes is null or p_offline_max_skew_minutes not between 1 and 4320 then
    raise exception using errcode = '22023', message = 'invalid_offline_max_skew_minutes';
  end if;
  if p_correction_max_age_days is null or p_correction_max_age_days not between 1 and 365 then
    raise exception using errcode = '22023', message = 'invalid_correction_max_age_days';
  end if;

  v_values := pg_catalog.jsonb_build_object(
    'retention_years', p_retention_years,
    'offline_clocking', p_offline_clocking,
    'offline_max_skew_minutes', p_offline_max_skew_minutes,
    'correction_max_age_days', p_correction_max_age_days
  );

  update public.organizations as organization
  set settings = organization.settings || v_values
  where organization.id = p_org;

  perform private.write_audit(p_org, 'organization.settings_updated', 'organization', p_org, v_values);
end;
$$;

create function public.rpc_update_org_settings(
  p_org uuid,
  p_retention_years integer,
  p_offline_clocking boolean,
  p_offline_max_skew_minutes integer,
  p_correction_max_age_days integer
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.update_org_settings(
    p_org, p_retention_years, p_offline_clocking, p_offline_max_skew_minutes, p_correction_max_age_days
  );
$$;

comment on function public.rpc_update_org_settings(uuid, integer, boolean, integer, integer) is
  'Owner/admin (fresh MFA): retention_years 5-10, offline_clocking, offline_max_skew_minutes 1-4320, correction_max_age_days 1-365.';

-- Access ------------------------------------------------------------------------------------

revoke all on function private.org_today(uuid) from public, anon, authenticated, service_role;
revoke all on function private.retention_years(uuid) from public, anon, authenticated, service_role;
revoke all on function private.require_offboard_scope(public.employees) from public, anon, authenticated, service_role;
revoke all on function private.offboard_employee(uuid, date) from public, anon, authenticated, service_role;
revoke all on function private.reinstate_employee(uuid) from public, anon, authenticated, service_role;
revoke all on function private.has_facts_since(uuid, uuid, timestamptz) from public, anon, authenticated, service_role;
revoke all on function private.anonymise_employee(uuid, date) from public, anon, authenticated, service_role;
revoke all on function private.run_retention() from public, anon, authenticated, service_role;
revoke all on function private.subject_document(uuid) from public, anon, authenticated, service_role;
revoke all on function private.subject_export(uuid) from public, anon, authenticated, service_role;
revoke all on function private.my_data_export() from public, anon, authenticated, service_role;
revoke all on function private.update_org_settings(uuid, integer, boolean, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_offboard_employee(uuid, date) from public, anon, authenticated, service_role;
revoke all on function public.rpc_reinstate_employee(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_subject_export(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_my_data_export() from public, anon, authenticated, service_role;
revoke all on function public.rpc_update_org_settings(uuid, integer, boolean, integer, integer)
  from public, anon, authenticated, service_role;

grant execute on function public.rpc_offboard_employee(uuid, date) to authenticated;
grant execute on function public.rpc_reinstate_employee(uuid) to authenticated;
grant execute on function public.rpc_subject_export(uuid) to authenticated;
grant execute on function public.rpc_my_data_export() to authenticated;
grant execute on function public.rpc_update_org_settings(uuid, integer, boolean, integer, integer) to authenticated;

-- Schedule --------------------------------------------------------------------------------

-- pg_cron runs in UTC: 01:15 UTC is 03:15 in Brussels in summer (CEST) and
-- 02:15 in winter (CET). The job runs as the migration owner (postgres),
-- which owns private.run_retention. Where pg_cron is unavailable the
-- migration still applies; see docs/decisions/007-gdpr-retention.md.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available: private.run_retention() is not scheduled';
    return;
  end if;

  begin
    create extension if not exists pg_cron with schema pg_catalog;
    execute $job$
      select cron.schedule('cloxa-retention', '15 1 * * *', 'select private.run_retention()')
    $job$;
  exception when others then
    raise notice 'pg_cron could not be enabled (%): private.run_retention() is not scheduled', sqlerrm;
  end;
end;
$$;
