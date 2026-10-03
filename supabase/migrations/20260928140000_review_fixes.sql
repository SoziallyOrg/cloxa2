-- Fixes from the security review of the 20260928130* migrations.
--
-- 1. Invitations can be revoked and expire (7 days). Revoked or expired
--    invitations cannot be linked or accepted and no longer block a new
--    invitation for the same email.
-- 2. Correction proposals: strictly increasing times, and no instant equal to
--    an existing effective event of the employee.
-- 3. Only an owner may decide their own correction request (audited as
--    self_decided); managers and admins never decide their own.
-- 4. Added correction events need an active site.
-- 5. Out-of-range UTC offsets map to invalid_proposed_time.
-- 6. Organization and site timezones must be known IANA names.

-- 6. Timezones ------------------------------------------------------------------------

-- A CHECK constraint cannot query pg_timezone_names, so a trigger does it.
create function private.validate_timezone()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_timezone_names as zone
    where zone.name = new.timezone
  ) then
    raise exception using errcode = '22023', message = 'invalid_timezone';
  end if;

  return new;
end;
$$;

create trigger organizations_validate_timezone
before insert or update of timezone on public.organizations
for each row execute function private.validate_timezone();

create trigger sites_validate_timezone
before insert or update of timezone on public.sites
for each row execute function private.validate_timezone();

revoke all on function private.validate_timezone() from public, anon, authenticated, service_role;

-- 1. Invitations: revoke and expiry ---------------------------------------------------------

alter table public.invitations add column expires_at timestamptz;

update public.invitations as invitation
set expires_at = invitation.created_at + interval '7 days';

alter table public.invitations
  alter column expires_at set default (clock_timestamp() + interval '7 days'),
  alter column expires_at set not null,
  add constraint invitations_expires_at_check check (expires_at > created_at);

alter table public.invitations drop constraint invitations_status_check;
alter table public.invitations
  add constraint invitations_status_check check (status in ('pending', 'linked', 'accepted', 'revoked'));

-- A revoked invitation keeps who it was linked to but no longer a membership.
alter table public.invitations drop constraint invitations_link_check;
alter table public.invitations
  add constraint invitations_link_check check (
    case status
      when 'pending' then user_id is null and membership_id is null
      when 'revoked' then membership_id is null
      else membership_id is not null
    end
  );

comment on column public.invitations.expires_at is
  'After this instant the invitation can no longer be linked or accepted.';

-- Closes an open (pending or linked) invitation. The person never joined, so
-- the never-activated membership is removed (nothing can reference it: an
-- invited membership has no access) and the employee row is deactivated. The
-- invitation row itself stays as the record.
create function private.close_invitation(p_invitation public.invitations, p_cause text)
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

  update public.employees as employee
  set active = false
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

create function private.revoke_invitation(p_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_invitation public.invitations;
  v_membership public.memberships;
begin
  select invitation.*
  into v_invitation
  from public.invitations as invitation
  where invitation.id = p_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_membership := private.require_privileged(v_invitation.organization_id);

  -- Owners and admins revoke any invitation; a manager only their own.
  if v_membership.role not in ('owner', 'admin')
    and v_invitation.invited_by is distinct from (select auth.uid())
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  select invitation.*
  into v_invitation
  from public.invitations as invitation
  where invitation.id = p_id
  for update;

  if v_invitation.status not in ('pending', 'linked') then
    raise exception using errcode = '55000', message = 'invitation_not_open';
  end if;

  perform private.close_invitation(v_invitation, 'revoked');
end;
$$;

create function public.rpc_revoke_invitation(p_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.revoke_invitation(p_id);
$$;

comment on function public.rpc_revoke_invitation(uuid) is
  'Privileged (fresh MFA): revoke an open invitation. Owners and admins any, a manager only their own.';

create or replace function private.invite_member(
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
  v_expired public.invitations;
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

  -- An expired open invitation no longer blocks a new one: close it first
  -- (this also removes its never-activated membership).
  for v_expired in
    select invitation.*
    from public.invitations as invitation
    where invitation.organization_id = p_org
      and invitation.email = v_email
      and invitation.status in ('pending', 'linked')
      and invitation.expires_at <= pg_catalog.clock_timestamp()
    for update
  loop
    perform private.close_invitation(v_expired, 'expired');
  end loop;

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

create or replace function private.link_invited_user(p_invitation_id uuid, p_user_id uuid)
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

  if v_invitation.status = 'revoked' then
    raise exception using errcode = '55000', message = 'invitation_revoked';
  end if;

  if v_invitation.expires_at <= pg_catalog.clock_timestamp() then
    raise exception using errcode = '55000', message = 'invitation_expired';
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

-- Revoked invitations are no longer 'linked'; expired ones are skipped.
create or replace function private.accept_membership()
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
      and invitation.expires_at > pg_catalog.clock_timestamp()
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

revoke all on function private.close_invitation(public.invitations, text) from public, anon, authenticated, service_role;
revoke all on function private.revoke_invitation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.rpc_revoke_invitation(uuid) from public, anon, authenticated, service_role;
grant execute on function public.rpc_revoke_invitation(uuid) to authenticated;

-- 5. Proposed time parsing ------------------------------------------------------------------

create or replace function private.parse_proposed_time(p_value jsonb)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if jsonb_typeof(p_value) is distinct from 'string'
    or (p_value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
  then
    return null;
  end if;

  return (p_value #>> '{}')::timestamptz;
exception
  when invalid_datetime_format or datetime_field_overflow or invalid_time_zone_displacement_value then
    return null;
end;
$$;

-- 2. Proposed instants ------------------------------------------------------------------------

-- Times of one proposal, in proposal order, must strictly increase and must
-- not coincide with any effective event of the employee: equal instants would
-- make the order of events depend on insert time instead of the facts.
create function private.proposed_times_problem(
  p_organization_id uuid,
  p_employee_id uuid,
  p_events jsonb
)
returns text
language sql
stable
set search_path = ''
as $$
  with proposed as (
    select (item.value ->> 'occurred_at')::timestamptz as at, item.ordinal
    from pg_catalog.jsonb_array_elements(coalesce(p_events, '[]'::jsonb)) with ordinality as item (value, ordinal)
  )
  select case
    when exists (
      select 1
      from proposed as earlier
      join proposed as later
        on later.ordinal = earlier.ordinal + 1
      where later.at <= earlier.at
    ) then 'proposed_times_not_increasing'
    when exists (
      select 1
      from public.clock_events as event
      join proposed
        on proposed.at = event.occurred_at
      where event.organization_id = p_organization_id
        and event.employee_id = p_employee_id
        and event.type <> 'void'
        and not exists (
          select 1
          from public.clock_events as superseding
          where superseding.supersedes_event_id = event.id
        )
    ) then 'proposed_time_conflict'
  end;
$$;

revoke all on function private.proposed_times_problem(uuid, uuid, jsonb) from public, anon, authenticated, service_role;

-- 2 + 4. rpc_request_correction ----------------------------------------------------------------

create or replace function private.request_correction(
  p_kind text,
  p_target_event_ids uuid[],
  p_proposed jsonb,
  p_reason text
)
returns public.correction_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_targets uuid[] := coalesce(p_target_event_ids, '{}');
  v_events jsonb;
  v_event jsonb;
  v_time timestamptz;
  v_site_ids uuid[] := '{}'::uuid[];
  v_adjusted uuid[] := '{}'::uuid[];
  v_normalized jsonb := '[]'::jsonb;
  v_added jsonb := '[]'::jsonb;
  v_organization_id uuid;
  v_target_employee_id uuid;
  v_employee_id uuid;
  v_oldest_allowed timestamptz;
  v_problem text;
  v_request public.correction_requests;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_kind is null or p_kind not in ('add', 'adjust', 'remove') then
    raise exception using errcode = '22023', message = 'invalid_kind';
  end if;

  if p_reason is null or pg_catalog.btrim(p_reason) = '' or pg_catalog.char_length(p_reason) > 280 then
    raise exception using errcode = '22023', message = 'invalid_reason';
  end if;

  if cardinality(v_targets) > 10
    or array_position(v_targets, null) is not null
    or (select pg_catalog.count(distinct target.id) from pg_catalog.unnest(v_targets) as target (id))
      <> cardinality(v_targets)
    or (p_kind = 'add') <> (cardinality(v_targets) = 0)
  then
    raise exception using errcode = '22023', message = 'invalid_targets';
  end if;

  if p_proposed is null
    or jsonb_typeof(p_proposed) <> 'object'
    or octet_length(p_proposed::text) > 4096
    or exists (
      select 1
      from pg_catalog.jsonb_object_keys(p_proposed) as proposed_key (name)
      where proposed_key.name <> 'events'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_proposal';
  end if;

  v_events := coalesce(p_proposed -> 'events', '[]'::jsonb);

  if jsonb_typeof(v_events) <> 'array'
    or (p_kind = 'remove' and jsonb_array_length(v_events) <> 0)
    or (p_kind = 'add' and jsonb_array_length(v_events) not between 1 and 8)
    or (p_kind = 'adjust' and jsonb_array_length(v_events) <> cardinality(v_targets))
  then
    raise exception using errcode = '22023', message = 'invalid_proposal';
  end if;

  -- Shape of every proposed event; times are range-checked once the org is known.
  for v_event in select item.value from pg_catalog.jsonb_array_elements(v_events) as item (value) loop
    if jsonb_typeof(v_event) <> 'object' then
      raise exception using errcode = '22023', message = 'invalid_proposal';
    end if;

    v_time := private.parse_proposed_time(v_event -> 'occurred_at');
    if v_time is null or v_time in ('infinity', '-infinity') then
      raise exception using errcode = '22023', message = 'invalid_proposed_time';
    end if;

    if p_kind = 'add' then
      if exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_event) as event_key (name)
          where event_key.name not in ('type', 'occurred_at', 'site_id')
        )
        or (v_event ->> 'type') is null
        or (v_event ->> 'type') not in ('clock_in', 'clock_out', 'break_start', 'break_end')
        or jsonb_typeof(v_event -> 'site_id') is distinct from 'string'
        or (v_event ->> 'site_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then
        raise exception using errcode = '22023', message = 'invalid_proposal';
      end if;

      v_site_ids := v_site_ids || (v_event ->> 'site_id')::uuid;
      v_normalized := v_normalized || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'type', v_event ->> 'type',
        'occurred_at', v_time,
        'site_id', (v_event ->> 'site_id')::uuid
      ));
    else
      if exists (
          select 1
          from pg_catalog.jsonb_object_keys(v_event) as event_key (name)
          where event_key.name not in ('target_event_id', 'occurred_at')
        )
        or jsonb_typeof(v_event -> 'target_event_id') is distinct from 'string'
        or (v_event ->> 'target_event_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or not ((v_event ->> 'target_event_id')::uuid = any (v_targets))
        or (v_event ->> 'target_event_id')::uuid = any (v_adjusted)
      then
        raise exception using errcode = '22023', message = 'invalid_proposal';
      end if;

      v_adjusted := v_adjusted || (v_event ->> 'target_event_id')::uuid;
      v_normalized := v_normalized || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'target_event_id', (v_event ->> 'target_event_id')::uuid,
        'occurred_at', v_time
      ));
    end if;
  end loop;

  -- The organization comes from the targets (adjust/remove) or the sites
  -- (add). Unknown ids and other people's events look the same.
  if p_kind = 'add' then
    select pg_catalog.min(site.organization_id::text)::uuid
    into v_organization_id
    from public.sites as site
    where site.id = any (v_site_ids);

    if v_organization_id is null or exists (
      select 1
      from pg_catalog.unnest(v_site_ids) as requested (site_id)
      where not exists (
        select 1
        from public.sites as site
        where site.id = requested.site_id
          and site.organization_id = v_organization_id
      )
    ) then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
  else
    select pg_catalog.min(event.organization_id::text)::uuid, pg_catalog.min(event.employee_id::text)::uuid
    into v_organization_id, v_target_employee_id
    from public.clock_events as event
    where event.id = any (v_targets);

    if v_organization_id is null or (
      select pg_catalog.count(*)
      from public.clock_events as event
      where event.id = any (v_targets)
        and event.organization_id = v_organization_id
        and event.employee_id = v_target_employee_id
    ) <> cardinality(v_targets) then
      raise exception using errcode = '42501', message = 'not_authorized';
    end if;
  end if;

  -- The caller acts for themselves only.
  select employee.id
  into v_employee_id
  from public.employees as employee
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  where employee.organization_id = v_organization_id
    and employee.user_id = v_user_id
    and employee.active
    and membership.status = 'active';

  if not found or (p_kind <> 'add' and v_employee_id <> v_target_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_kind = 'add' and exists (
    select 1
    from pg_catalog.unnest(v_site_ids) as requested (site_id)
    where not exists (
      select 1
      from public.site_assignments as assignment
      where assignment.organization_id = v_organization_id
        and assignment.site_id = requested.site_id
        and assignment.employee_id = v_employee_id
    )
  ) then
    raise exception using errcode = '42501', message = 'site_not_assigned';
  end if;

  if p_kind = 'add' and exists (
    select 1
    from public.sites as site
    where site.id = any (v_site_ids)
      and not site.active
  ) then
    raise exception using errcode = '22023', message = 'site_inactive';
  end if;

  if exists (
    select 1
    from public.clock_events as event
    where event.id = any (v_targets)
      and (
        event.type = 'void'
        or exists (
          select 1
          from public.clock_events as superseding
          where superseding.supersedes_event_id = event.id
        )
      )
  ) then
    raise exception using errcode = '22023', message = 'target_not_effective';
  end if;

  v_oldest_allowed := v_now - pg_catalog.make_interval(days => private.correction_max_age_days(v_organization_id));

  if exists (
    select 1
    from public.clock_events as event
    where event.id = any (v_targets)
      and event.occurred_at < v_oldest_allowed
  ) then
    raise exception using errcode = '22023', message = 'target_too_old';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized) as item (value)
    where (item.value ->> 'occurred_at')::timestamptz > v_now
  ) then
    raise exception using errcode = '22023', message = 'proposed_time_in_future';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_normalized) as item (value)
    where (item.value ->> 'occurred_at')::timestamptz < v_oldest_allowed
  ) then
    raise exception using errcode = '22023', message = 'proposed_time_too_old';
  end if;

  v_problem := private.proposed_times_problem(v_organization_id, v_employee_id, v_normalized);
  if v_problem is not null then
    raise exception using errcode = '22023', message = v_problem;
  end if;

  -- Early feedback only; approval re-validates under the employee lock.
  if p_kind = 'add' then
    v_added := v_normalized;
  elsif p_kind = 'adjust' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'type', event.type,
      'occurred_at', item.value -> 'occurred_at'
    ) order by item.ordinal), '[]'::jsonb)
    into v_added
    from pg_catalog.jsonb_array_elements(v_normalized) with ordinality as item (value, ordinal)
    join public.clock_events as event
      on event.id = (item.value ->> 'target_event_id')::uuid;
  end if;

  v_problem := private.correction_sequence_problem(v_organization_id, v_employee_id, v_targets, v_added);
  if v_problem is not null then
    raise exception using errcode = 'P0001', message = 'invalid_sequence', detail = v_problem;
  end if;

  if (
    select pg_catalog.count(*)
    from public.correction_requests as pending
    where pending.organization_id = v_organization_id
      and pending.employee_id = v_employee_id
      and pending.status = 'pending'
  ) >= 20 then
    raise exception using errcode = 'P0001', message = 'too_many_pending';
  end if;

  insert into public.correction_requests (
    organization_id, employee_id, requested_by, kind, target_event_ids, proposed, reason
  )
  values (
    v_organization_id,
    v_employee_id,
    v_user_id,
    p_kind,
    v_targets,
    pg_catalog.jsonb_build_object('events', v_normalized),
    p_reason
  )
  returning * into v_request;

  perform private.write_audit(
    v_organization_id,
    'correction_request.created',
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_employee_id,
      'kind', p_kind,
      'target_count', cardinality(v_targets),
      'event_count', jsonb_array_length(v_normalized)
    )
  );

  return v_request;
end;
$$;

-- 2 + 3 + 4. rpc_decide_correction --------------------------------------------------------------

create or replace function private.decide_correction(p_id uuid, p_decision text, p_note text default null)
returns public.correction_requests
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_organization_id uuid;
  v_employee_id uuid;
  v_membership public.memberships;
  v_self boolean;
  v_request public.correction_requests;
  v_item record;
  v_target public.clock_events;
  v_event public.clock_events;
  v_added jsonb := '[]'::jsonb;
  v_problem text;
  v_event_count integer := 0;
begin
  select request.organization_id, request.employee_id
  into v_organization_id, v_employee_id
  from public.correction_requests as request
  where request.id = p_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  v_membership := private.require_privileged(v_organization_id);

  if not private.can_see_employee(v_employee_id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  -- Only an owner decides their own request (single-owner businesses); a
  -- manager or admin never does. Recorded as self_decided in the audit row.
  v_self := exists (
    select 1
    from public.employees as employee
    where employee.id = v_employee_id
      and employee.user_id = v_user_id
  );

  if v_self and v_membership.role <> 'owner' then
    raise exception using errcode = '42501', message = 'self_decision_not_allowed';
  end if;

  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception using errcode = '22023', message = 'invalid_decision';
  end if;

  if p_note is not null and (pg_catalog.btrim(p_note) = '' or pg_catalog.char_length(p_note) > 280) then
    raise exception using errcode = '22023', message = 'invalid_note';
  end if;

  -- Lock order: employee (1003) first; the clock chain (1002) and audit chain
  -- (1001) locks follow through the append triggers.
  perform pg_catalog.pg_advisory_xact_lock(1003, pg_catalog.hashtext(v_employee_id::text));

  select request.*
  into v_request
  from public.correction_requests as request
  where request.id = p_id
  for update;

  if v_request.status <> 'pending' then
    raise exception using errcode = '55000', message = 'correction_not_pending';
  end if;

  if p_decision = 'approved' then
    -- Targets must still be the employee's effective events.
    if (
      select pg_catalog.count(*)
      from public.clock_events as event
      where event.id = any (v_request.target_event_ids)
        and event.organization_id = v_request.organization_id
        and event.employee_id = v_request.employee_id
        and event.type <> 'void'
        and not exists (
          select 1
          from public.clock_events as superseding
          where superseding.supersedes_event_id = event.id
        )
    ) <> cardinality(v_request.target_event_ids) then
      raise exception using errcode = '55000', message = 'target_not_effective';
    end if;

    if exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_request.proposed -> 'events') as item (value)
      where (item.value ->> 'occurred_at')::timestamptz > pg_catalog.clock_timestamp()
    ) then
      raise exception using errcode = '22023', message = 'proposed_time_in_future';
    end if;

    if v_request.kind = 'add' and exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_request.proposed -> 'events') as item (value)
      join public.sites as site
        on site.id = (item.value ->> 'site_id')::uuid
      where not site.active
    ) then
      raise exception using errcode = '55000', message = 'site_inactive';
    end if;

    -- Events appended since the request may now share an instant.
    v_problem := private.proposed_times_problem(
      v_request.organization_id, v_request.employee_id, v_request.proposed -> 'events'
    );
    if v_problem is not null then
      raise exception using errcode = '22023', message = v_problem;
    end if;

    if v_request.kind = 'add' then
      v_added := v_request.proposed -> 'events';
    elsif v_request.kind = 'adjust' then
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'type', event.type,
        'occurred_at', item.value -> 'occurred_at'
      ) order by item.ordinal), '[]'::jsonb)
      into v_added
      from pg_catalog.jsonb_array_elements(v_request.proposed -> 'events') with ordinality as item (value, ordinal)
      join public.clock_events as event
        on event.id = (item.value ->> 'target_event_id')::uuid;
    end if;

    v_problem := private.correction_sequence_problem(
      v_request.organization_id, v_request.employee_id, v_request.target_event_ids, v_added
    );
    if v_problem is not null then
      raise exception using errcode = 'P0001', message = 'invalid_sequence', detail = v_problem;
    end if;

    -- Append. One row per event: add -> new event, adjust -> superseding
    -- event of the same type and site, remove -> void at the original time.
    for v_item in
      select
        case v_request.kind when 'add' then item.value ->> 'type' else null end as type,
        case v_request.kind when 'add' then (item.value ->> 'site_id')::uuid else null end as site_id,
        (item.value ->> 'occurred_at')::timestamptz as occurred_at,
        (item.value ->> 'target_event_id')::uuid as target_event_id
      from pg_catalog.jsonb_array_elements(
        case v_request.kind
          when 'remove' then (
            select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('target_event_id', target.id) order by target.ordinal)
            from pg_catalog.unnest(v_request.target_event_ids) with ordinality as target (id, ordinal)
          )
          else v_request.proposed -> 'events'
        end
      ) with ordinality as item (value, ordinal)
      order by item.ordinal
    loop
      if v_item.target_event_id is not null then
        select event.*
        into v_target
        from public.clock_events as event
        where event.id = v_item.target_event_id;
      end if;

      insert into public.clock_events (
        organization_id,
        site_id,
        employee_id,
        type,
        occurred_at,
        server_at,
        source,
        supersedes_event_id,
        correction_id,
        actor_user_id,
        idempotency_key
      )
      values (
        v_request.organization_id,
        case v_request.kind when 'add' then v_item.site_id else v_target.site_id end,
        v_request.employee_id,
        case v_request.kind when 'add' then v_item.type when 'adjust' then v_target.type else 'void' end,
        case v_request.kind when 'remove' then v_target.occurred_at else v_item.occurred_at end,
        pg_catalog.clock_timestamp(),
        'correction',
        case v_request.kind when 'add' then null else v_target.id end,
        v_request.id,
        v_user_id,
        gen_random_uuid()
      )
      returning * into v_event;

      perform private.write_audit(
        v_request.organization_id,
        'clock_event.recorded',
        'clock_event',
        v_event.id,
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'employee_id', v_event.employee_id,
          'site_id', v_event.site_id,
          'type', v_event.type,
          'source', 'correction',
          'correction_id', v_request.id,
          'supersedes_event_id', v_event.supersedes_event_id
        ))
      );

      v_event_count := v_event_count + 1;
    end loop;
  end if;

  update public.correction_requests as request
  set status = p_decision,
      decided_by = v_user_id,
      decided_at = pg_catalog.clock_timestamp(),
      decision_note = p_note
  where request.id = p_id
  returning * into v_request;

  perform private.write_audit(
    v_request.organization_id,
    'correction_request.' || p_decision,
    'correction_request',
    v_request.id,
    pg_catalog.jsonb_build_object(
      'employee_id', v_request.employee_id,
      'kind', v_request.kind,
      'event_count', v_event_count,
      'self_decided', v_self
    )
  );

  return v_request;
end;
$$;
