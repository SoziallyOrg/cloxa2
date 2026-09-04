-- Phase 9: bounded manager roster, employee administration, and pilot settings.

-- Suspension is distinct from legacy inactive/invited states. Existing values remain
-- unchanged and every organization-scoped policy already requires status = 'active'.
alter table public.memberships
  drop constraint memberships_status_check,
  add constraint memberships_status_check
    check (status in ('invited', 'active', 'inactive', 'suspended'));

-- Codes compare after trimming surrounding ASCII spaces and lower-casing.
-- Abort instead of rewriting existing values if historical data conflicts.
do $$
begin
  if exists (
    select 1
    from public.memberships as membership
    where membership.employee_code is not null
    group by membership.organization_id,
      pg_catalog.lower(pg_catalog.btrim(membership.employee_code))
    having pg_catalog.count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'memberships_normalized_employee_code_conflict';
  end if;
end;
$$;

create unique index memberships_organization_employee_code_normalized_key
  on public.memberships (
    organization_id,
    pg_catalog.lower(pg_catalog.btrim(employee_code))
  )
  where employee_code is not null;

create table private.manager_team_operations (
  request_id uuid primary key,
  organization_id uuid not null,
  actor_membership_id uuid not null,
  target_entity_type text not null,
  target_entity_id uuid not null,
  action text not null,
  payload_hash bytea not null,
  result_code text not null,
  result jsonb not null,
  processed_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint manager_team_operations_actor_fkey
    foreign key (organization_id, actor_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint manager_team_operations_target_type_check
    check (target_entity_type in ('membership', 'organization')),
  constraint manager_team_operations_action_check
    check (action in (
      'employee_profile_update',
      'employee_suspend',
      'employee_reactivate',
      'pilot_settings_update'
    )),
  constraint manager_team_operations_hash_check
    check (pg_catalog.octet_length(payload_hash) = 32),
  constraint manager_team_operations_result_check
    check (pg_catalog.jsonb_typeof(result) = 'object')
);

create index manager_team_operations_actor_idx
  on private.manager_team_operations (organization_id, actor_membership_id, processed_at desc);

create index manager_team_operations_target_idx
  on private.manager_team_operations (
    organization_id,
    target_entity_type,
    target_entity_id,
    processed_at desc
  );

alter table private.manager_team_operations enable row level security;

create function private.reject_manager_team_operation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = 'manager_team_operations are append-only';
  return null;
end;
$$;

create trigger manager_team_operations_reject_mutation
before update or delete on private.manager_team_operations
for each row execute function private.reject_manager_team_operation_mutation();

create trigger manager_team_operations_reject_truncate
before truncate on private.manager_team_operations
for each statement execute function private.reject_manager_team_operation_mutation();

-- One live manager membership and one worksite are mandatory. This helper returns no
-- row for anonymous, stale-session, ambiguous-membership, or suspended-tenant callers.
create function private.manager_admin_context()
returns table (
  manager_membership_id uuid,
  organization_id uuid,
  worksite_id uuid
)
language sql
volatile
security definer
set search_path = ''
as $$
  select membership.id, membership.organization_id, worksite.worksite_id
  from public.memberships as membership
  join public.organizations as organization
    on organization.id = membership.organization_id
  join auth.users as auth_user on auth_user.id = membership.user_id
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  join lateral (
    select (pg_catalog.array_agg(site.id order by site.id))[1] as worksite_id,
      pg_catalog.count(*) as worksite_count
    from public.worksites as site
    where site.organization_id = membership.organization_id
  ) as worksite on worksite.worksite_count = 1
    and exists (
      select 1 from public.worksites as fixed_site
      where fixed_site.id = worksite.worksite_id
        and fixed_site.timezone = 'Europe/Brussels'
    )
  where pg_catalog.current_setting('role', true) = 'authenticated'
    and coalesce(auth.role(), 'authenticated') = 'authenticated'
    and membership.user_id = auth.uid()
    and membership.role = 'manager'
    and membership.status = 'active'
    and (
      select pg_catalog.count(*)
      from public.memberships as active_membership
      where active_membership.user_id = auth.uid()
        and active_membership.status = 'active'
    ) = 1
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and (
      auth_user.banned_until is null
      or auth_user.banned_until <= pg_catalog.clock_timestamp()
    )
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (
      auth_session.not_after is null
      or auth_session.not_after > pg_catalog.clock_timestamp()
    )
    and (
      not (auth.jwt() ? 'exp')
      or case
        when pg_catalog.jsonb_typeof(auth.jwt() -> 'exp') = 'number'
          then (auth.jwt() ->> 'exp')::numeric
            > extract(epoch from pg_catalog.clock_timestamp())
        else false
      end
    );
$$;

create function private.get_manager_team(client_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  read_manager_id uuid;
  target_organization_id uuid;
  target_worksite_id uuid;
  caller_id uuid := auth.uid();
  result jsonb;
begin
  if client_request_id is null then
    raise exception using errcode = '22023', message = 'manager_team_invalid_request';
  end if;

  perform auth_user.id
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
  for share of auth_user, auth_session;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into read_manager_id, target_organization_id, target_worksite_id
  from private.manager_admin_context() as context;
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Teamoverzicht kan niet worden geladen.';
  end if;

  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for share;
  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id for share;
  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;
  if not exists (
    select 1 from private.manager_admin_context() as context
    where context.manager_membership_id = read_manager_id
      and context.organization_id = target_organization_id
      and context.worksite_id = target_worksite_id
  ) then
    raise exception using errcode = '42501', message = 'Teamoverzicht kan niet worden geladen.';
  end if;

  select pg_catalog.jsonb_build_object(
    'request_id', client_request_id,
    'organization_id', organization.id,
    'organization_name', organization.name,
    'worksite_id', worksite.id,
    'worksite_name', worksite.name,
    'timezone', worksite.timezone,
    'employees', coalesce(employee_rows.value, '[]'::jsonb),
    'invitations', coalesce(invitation_rows.value, '[]'::jsonb)
  )
  into result
  from public.organizations as organization
  join public.worksites as worksite
    on worksite.id = target_worksite_id
    and worksite.organization_id = organization.id
  cross join lateral (
    select pg_catalog.jsonb_agg(employee.item order by employee.sort_name,
      employee.created_at, employee.membership_id) as value
    from (
      select membership.id as membership_id,
        pg_catalog.lower(coalesce(profile.display_name, '')) as sort_name,
        membership.created_at,
        pg_catalog.jsonb_build_object(
          'membership_id', membership.id,
          'display_name', profile.display_name,
          'employee_code', membership.employee_code,
          'account_email', case when auth_user.deleted_at is null
            then nullif(pg_catalog.btrim(auth_user.email), '') end,
          'membership_status', membership.status,
          'created_at', membership.created_at,
          'activated_at', activation.activated_at,
          'has_open_shift', exists (
            select 1 from public.time_entries as entry
            where entry.organization_id = membership.organization_id
              and entry.membership_id = membership.id
              and entry.ended_at is null
          ),
          'has_open_break', exists (
            select 1 from public.time_breaks as time_break
            where time_break.organization_id = membership.organization_id
              and time_break.employee_membership_id = membership.id
              and time_break.ended_at is null
          ),
          'pending_time_correction_count', (
            select pg_catalog.count(*)
            from public.correction_requests as correction
            where correction.organization_id = membership.organization_id
              and correction.employee_membership_id = membership.id
              and correction.status = 'pending'
          ),
          'pending_break_correction_count', (
            select pg_catalog.count(*)
            from public.break_correction_requests as correction
            where correction.organization_id = membership.organization_id
              and correction.employee_membership_id = membership.id
              and correction.status = 'pending'
          )
        ) as item
      from public.memberships as membership
      join auth.users as auth_user on auth_user.id = membership.user_id
      left join public.profiles as profile on profile.user_id = membership.user_id
      left join lateral (
        select pg_catalog.min(invitation.accepted_at) as activated_at
        from public.invitations as invitation
        where invitation.organization_id = membership.organization_id
          and invitation.accepted_by = membership.user_id
          and invitation.status = 'accepted'
      ) as activation on true
      where membership.organization_id = target_organization_id
        and membership.role = 'employee'
      order by pg_catalog.lower(coalesce(profile.display_name, '')),
        membership.created_at, membership.id
      limit 100
    ) as employee
  ) as employee_rows
  cross join lateral (
    select pg_catalog.jsonb_agg(invitation.item order by invitation.created_at desc,
      invitation.email, invitation.invitation_id) as value
    from (
      select row.id as invitation_id, row.created_at,
        row.normalized_email as email,
        pg_catalog.jsonb_build_object(
          'email', row.normalized_email,
          'status', case
            when row.status = 'pending'
              and row.expires_at <= pg_catalog.clock_timestamp() then 'expired'
            else row.status
          end,
          'created_at', row.created_at,
          'expires_at', row.expires_at,
          'accepted_at', row.accepted_at,
          'revoked_at', row.revoked_at
        ) as item
      from public.invitations as row
      where row.organization_id = target_organization_id
      order by row.created_at desc, row.normalized_email, row.id
      limit 100
    ) as invitation
  ) as invitation_rows
  where organization.id = target_organization_id
    and worksite.timezone = 'Europe/Brussels';

  if result is null then
    raise exception using errcode = '42501', message = 'Teamoverzicht kan niet worden geladen.';
  end if;
  return result;
end;
$$;

create function private.update_employee_profile(
  client_request_id uuid,
  client_target_membership_id uuid,
  client_display_name text,
  client_employee_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  manager_membership_id uuid;
  target_organization_id uuid;
  target_worksite_id uuid;
  rechecked_manager_id uuid;
  rechecked_organization_id uuid;
  rechecked_worksite_id uuid;
  target_user_id uuid;
  target_membership public.memberships%rowtype;
  target_profile public.profiles%rowtype;
  normalized_name text := pg_catalog.btrim(client_display_name);
  normalized_code text := nullif(pg_catalog.btrim(client_employee_code), '');
  operation_hash bytea;
  prior_operation private.manager_team_operations%rowtype;
  outcome text;
  did_change boolean;
  changed_fields text[];
  result jsonb;
begin
  if client_request_id is null or client_target_membership_id is null
    or normalized_name is null
    or pg_catalog.length(normalized_name) not between 1 and 100
    or normalized_name ~ '[[:cntrl:]]'
    or pg_catalog.length(normalized_code) > 32
    or normalized_code ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'manager_team_invalid_profile';
  end if;

  perform auth_user.id
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
  for share of auth_user, auth_session;
  if caller_id is null or not found then
    raise exception using errcode = '42501', message = 'Medewerker kan niet worden bijgewerkt.';
  end if;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into manager_membership_id, target_organization_id, target_worksite_id
  from private.manager_admin_context() as context;
  select membership.user_id into target_user_id
  from public.memberships as membership
  where membership.id = client_target_membership_id
    and membership.organization_id = target_organization_id
    and membership.role = 'employee';
  if target_organization_id is null or target_user_id is null then
    raise exception using errcode = '42501', message = 'Medewerker kan niet worden bijgewerkt.';
  end if;

  operation_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      'employee_profile_update', client_target_membership_id,
      normalized_name, normalized_code
    )::text,
    'UTF8'
  ));

  -- Operation UUID, target employee serialization, memberships, organization,
  -- worksite, then profile. This matches employee/export ordering.
  perform pg_catalog.pg_advisory_xact_lock(
    17081, pg_catalog.hashtext(client_request_id::text)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    17031, pg_catalog.hashtext(target_user_id::text)
  );
  perform membership.id
  from public.memberships as membership
  where membership.user_id in (caller_id, target_user_id)
  order by membership.id
  for update;
  perform organization.id
  from public.organizations as organization
  where organization.id = target_organization_id
  for share;
  perform worksite.id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id
  for share;
  select profile.* into target_profile
  from public.profiles as profile
  where profile.user_id = target_user_id
  for update;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into rechecked_manager_id, rechecked_organization_id, rechecked_worksite_id
  from private.manager_admin_context() as context;
  select membership.* into target_membership
  from public.memberships as membership
  where membership.id = client_target_membership_id;
  if rechecked_manager_id is distinct from manager_membership_id
    or rechecked_organization_id is distinct from target_organization_id
    or rechecked_worksite_id is distinct from target_worksite_id
    or target_membership.organization_id is distinct from target_organization_id
    or target_membership.user_id is distinct from target_user_id
    or target_membership.role is distinct from 'employee'
    or target_membership.status not in ('active', 'suspended')
    or target_profile.user_id is null then
    raise exception using errcode = '42501', message = 'Medewerker kan niet worden bijgewerkt.';
  end if;

  select operation.* into prior_operation
  from private.manager_team_operations as operation
  where operation.request_id = client_request_id;
  if found then
    if prior_operation.actor_membership_id <> manager_membership_id
      or prior_operation.target_entity_type <> 'membership'
      or prior_operation.target_entity_id <> client_target_membership_id
      or prior_operation.action <> 'employee_profile_update'
      or prior_operation.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'manager_team_request_id_reused';
    end if;
    return prior_operation.result;
  end if;

  if normalized_code is not null and exists (
    select 1
    from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.id <> client_target_membership_id
      and membership.employee_code is not null
      and pg_catalog.lower(pg_catalog.btrim(membership.employee_code))
        = pg_catalog.lower(normalized_code)
  ) then
    outcome := 'duplicate_employee_code';
    did_change := false;
  else
    changed_fields := pg_catalog.array_remove(array[
      case when target_profile.display_name is distinct from normalized_name
        then 'display_name' end,
      case when target_membership.employee_code is distinct from normalized_code
        then 'employee_code' end
    ]::text[], null);
    did_change := pg_catalog.cardinality(changed_fields) > 0;
    outcome := case when did_change then 'updated' else 'unchanged' end;

    if did_change then
      begin
        if target_profile.display_name is distinct from normalized_name then
          update public.profiles
          set display_name = normalized_name
          where user_id = target_user_id;
        end if;
        if target_membership.employee_code is distinct from normalized_code then
          update public.memberships
          set employee_code = normalized_code
          where id = client_target_membership_id;
        end if;
      exception when unique_violation then
        outcome := 'duplicate_employee_code';
        did_change := false;
      end;
    end if;

    if did_change then
      insert into public.audit_events (
        organization_id, actor_user_id, entity_type, entity_id, action, after_data
      ) values (
        target_organization_id, caller_id, 'membership', client_target_membership_id,
        'employee_profile.updated',
        pg_catalog.jsonb_build_object('changed_fields', changed_fields)
      );
    end if;
  end if;

  if did_change then
    target_profile.display_name := normalized_name;
    target_membership.employee_code := normalized_code;
  end if;
  result := pg_catalog.jsonb_build_object(
    'request_id', client_request_id,
    'result_code', outcome,
    'did_change', did_change,
    'target_membership_id', client_target_membership_id,
    'display_name', target_profile.display_name,
    'employee_code', target_membership.employee_code
  );
  insert into private.manager_team_operations (
    request_id, organization_id, actor_membership_id, target_entity_type,
    target_entity_id, action, payload_hash, result_code, result
  ) values (
    client_request_id, target_organization_id, manager_membership_id, 'membership',
    client_target_membership_id, 'employee_profile_update', operation_hash,
    outcome, result
  );
  return result;
end;
$$;

create function private.change_employee_membership_status(
  client_request_id uuid,
  client_target_membership_id uuid,
  client_action text,
  client_confirmed boolean
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  manager_membership_id uuid;
  target_organization_id uuid;
  target_worksite_id uuid;
  rechecked_manager_id uuid;
  rechecked_organization_id uuid;
  rechecked_worksite_id uuid;
  target_user_id uuid;
  target_membership public.memberships%rowtype;
  operation_name text;
  operation_hash bytea;
  prior_operation private.manager_team_operations%rowtype;
  has_open_shift boolean;
  has_open_break boolean;
  pending_time_count bigint;
  pending_break_count bigint;
  active_membership_count bigint;
  outcome text;
  did_change boolean := false;
  resulting_status text;
  result jsonb;
begin
  if client_request_id is null or client_target_membership_id is null
    or client_action is null or client_action not in ('suspend', 'reactivate')
    or client_confirmed is null then
    raise exception using errcode = '22023', message = 'manager_team_invalid_status_change';
  end if;
  operation_name := case client_action
    when 'suspend' then 'employee_suspend'
    else 'employee_reactivate'
  end;

  perform auth_user.id
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
  for share of auth_user, auth_session;
  if caller_id is null or not found then
    raise exception using errcode = '42501', message = 'Toegang kan niet worden gewijzigd.';
  end if;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into manager_membership_id, target_organization_id, target_worksite_id
  from private.manager_admin_context() as context;
  select membership.user_id into target_user_id
  from public.memberships as membership
  where membership.id = client_target_membership_id
    and membership.organization_id = target_organization_id
    and membership.role = 'employee';
  if target_organization_id is null or target_user_id is null then
    raise exception using errcode = '42501', message = 'Toegang kan niet worden gewijzigd.';
  end if;

  operation_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      operation_name, client_target_membership_id, client_confirmed
    )::text,
    'UTF8'
  ));

  perform pg_catalog.pg_advisory_xact_lock(
    17081, pg_catalog.hashtext(client_request_id::text)
  );
  if client_action = 'reactivate' then
    -- Existing invitation acceptance uses 17022 for active-membership admission.
    perform pg_catalog.pg_advisory_xact_lock(
      17022, pg_catalog.hashtext(target_user_id::text)
    );
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    17031, pg_catalog.hashtext(target_user_id::text)
  );
  perform membership.id
  from public.memberships as membership
  where membership.user_id in (caller_id, target_user_id)
  order by membership.id
  for update;
  perform organization.id
  from public.organizations as organization
  where organization.id = target_organization_id
  for share;
  perform worksite.id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id
  for share;
  perform entry.id
  from public.time_entries as entry
  where entry.membership_id = client_target_membership_id
  order by entry.id
  for update;
  perform time_break.id
  from public.time_breaks as time_break
  where time_break.employee_membership_id = client_target_membership_id
  order by time_break.id
  for share;
  perform correction.id
  from public.correction_requests as correction
  where correction.employee_membership_id = client_target_membership_id
  order by correction.id
  for share;
  perform correction.id
  from public.break_correction_requests as correction
  where correction.employee_membership_id = client_target_membership_id
  order by correction.id
  for share;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into rechecked_manager_id, rechecked_organization_id, rechecked_worksite_id
  from private.manager_admin_context() as context;
  select membership.* into target_membership
  from public.memberships as membership
  where membership.id = client_target_membership_id;
  if rechecked_manager_id is distinct from manager_membership_id
    or rechecked_organization_id is distinct from target_organization_id
    or rechecked_worksite_id is distinct from target_worksite_id
    or target_membership.organization_id is distinct from target_organization_id
    or target_membership.user_id is distinct from target_user_id
    or target_membership.role is distinct from 'employee' then
    raise exception using errcode = '42501', message = 'Toegang kan niet worden gewijzigd.';
  end if;

  select operation.* into prior_operation
  from private.manager_team_operations as operation
  where operation.request_id = client_request_id;
  if found then
    if prior_operation.actor_membership_id <> manager_membership_id
      or prior_operation.target_entity_type <> 'membership'
      or prior_operation.target_entity_id <> client_target_membership_id
      or prior_operation.action <> operation_name
      or prior_operation.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'manager_team_request_id_reused';
    end if;
    return prior_operation.result;
  end if;

  select exists (
      select 1 from public.time_entries as entry
      where entry.membership_id = client_target_membership_id
        and entry.ended_at is null
    ), exists (
      select 1 from public.time_breaks as time_break
      where time_break.employee_membership_id = client_target_membership_id
        and time_break.ended_at is null
    ), (
      select pg_catalog.count(*) from public.correction_requests as correction
      where correction.employee_membership_id = client_target_membership_id
        and correction.status = 'pending'
    ), (
      select pg_catalog.count(*) from public.break_correction_requests as correction
      where correction.employee_membership_id = client_target_membership_id
        and correction.status = 'pending'
    )
  into has_open_shift, has_open_break, pending_time_count, pending_break_count;

  resulting_status := target_membership.status;
  if client_confirmed is distinct from true then
    outcome := 'confirmation_required';
  elsif client_action = 'suspend' and target_membership.status = 'suspended' then
    outcome := 'already_suspended';
  elsif client_action = 'reactivate' and target_membership.status = 'active' then
    outcome := 'already_active';
  elsif client_action = 'suspend' and target_membership.status <> 'active' then
    outcome := 'unavailable';
  elsif client_action = 'reactivate' and target_membership.status <> 'suspended' then
    outcome := 'unavailable';
  elsif client_action = 'suspend' and has_open_break then
    outcome := 'open_break';
  elsif client_action = 'suspend' and has_open_shift then
    outcome := 'open_shift';
  elsif client_action = 'reactivate' then
    select pg_catalog.count(*) into active_membership_count
    from public.memberships as membership
    where membership.user_id = target_user_id
      and membership.status = 'active';
    if active_membership_count <> 0 then
      outcome := 'ambiguous_membership';
    else
      update public.memberships
      set status = 'active'
      where id = client_target_membership_id;
      outcome := 'reactivated';
      did_change := true;
      resulting_status := 'active';
      insert into public.audit_events (
        organization_id, actor_user_id, entity_type, entity_id,
        action, before_data, after_data
      ) values (
        target_organization_id, caller_id, 'membership', client_target_membership_id,
        'employee_membership.reactivated',
        '{"status":"suspended"}'::jsonb,
        '{"status":"active"}'::jsonb
      );
    end if;
  else
    update public.memberships
    set status = 'suspended'
    where id = client_target_membership_id;
    outcome := 'suspended';
    did_change := true;
    resulting_status := 'suspended';
    insert into public.audit_events (
      organization_id, actor_user_id, entity_type, entity_id,
      action, before_data, after_data
    ) values (
      target_organization_id, caller_id, 'membership', client_target_membership_id,
      'employee_membership.suspended',
      '{"status":"active"}'::jsonb,
      '{"status":"suspended"}'::jsonb
    );
  end if;

  result := pg_catalog.jsonb_build_object(
    'request_id', client_request_id,
    'result_code', outcome,
    'did_change', did_change,
    'target_membership_id', client_target_membership_id,
    'membership_status', resulting_status,
    'has_open_shift', has_open_shift,
    'has_open_break', has_open_break,
    'pending_time_correction_count', pending_time_count,
    'pending_break_correction_count', pending_break_count
  );
  insert into private.manager_team_operations (
    request_id, organization_id, actor_membership_id, target_entity_type,
    target_entity_id, action, payload_hash, result_code, result
  ) values (
    client_request_id, target_organization_id, manager_membership_id, 'membership',
    client_target_membership_id, operation_name, operation_hash, outcome, result
  );
  return result;
end;
$$;

create function private.update_pilot_settings(
  client_request_id uuid,
  client_organization_name text,
  client_worksite_name text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  manager_membership_id uuid;
  target_organization_id uuid;
  target_worksite_id uuid;
  rechecked_manager_id uuid;
  rechecked_organization_id uuid;
  rechecked_worksite_id uuid;
  employee_user_id uuid;
  normalized_organization_name text := pg_catalog.btrim(client_organization_name);
  normalized_worksite_name text := pg_catalog.btrim(client_worksite_name);
  current_organization_name text;
  current_worksite_name text;
  operation_hash bytea;
  prior_operation private.manager_team_operations%rowtype;
  organization_changed boolean;
  worksite_changed boolean;
  outcome text;
  result jsonb;
begin
  if client_request_id is null
    or normalized_organization_name is null
    or normalized_worksite_name is null
    or pg_catalog.length(normalized_organization_name) not between 1 and 120
    or pg_catalog.length(normalized_worksite_name) not between 1 and 120
    or normalized_organization_name ~ '[[:cntrl:]]'
    or normalized_worksite_name ~ '[[:cntrl:]]' then
    raise exception using errcode = '22023', message = 'manager_team_invalid_settings';
  end if;

  perform auth_user.id
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
  for share of auth_user, auth_session;
  if caller_id is null or not found then
    raise exception using errcode = '42501', message = 'Pilotinstellingen kunnen niet worden bijgewerkt.';
  end if;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into manager_membership_id, target_organization_id, target_worksite_id
  from private.manager_admin_context() as context;
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Pilotinstellingen kunnen niet worden bijgewerkt.';
  end if;

  operation_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      'pilot_settings_update', target_organization_id, target_worksite_id,
      normalized_organization_name, normalized_worksite_name
    )::text,
    'UTF8'
  ));

  -- Export creation takes the same employee keys before memberships, organization,
  -- and worksite, so each snapshot sees one complete old-or-new settings state.
  perform pg_catalog.pg_advisory_xact_lock(
    17081, pg_catalog.hashtext(client_request_id::text)
  );
  for employee_user_id in
    select membership.user_id
    from public.memberships as membership
    where membership.organization_id = target_organization_id
      and membership.role = 'employee'
    group by membership.user_id
    order by pg_catalog.hashtext(membership.user_id::text), membership.user_id
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      17031, pg_catalog.hashtext(employee_user_id::text)
    );
  end loop;
  perform membership.id
  from public.memberships as membership
  where membership.organization_id = target_organization_id
  order by membership.id
  for share;
  select organization.name into current_organization_name
  from public.organizations as organization
  where organization.id = target_organization_id
  for update;
  select worksite.name into current_worksite_name
  from public.worksites as worksite
  where worksite.id = target_worksite_id
    and worksite.organization_id = target_organization_id
    and worksite.timezone = 'Europe/Brussels'
  for update;

  select context.manager_membership_id, context.organization_id, context.worksite_id
  into rechecked_manager_id, rechecked_organization_id, rechecked_worksite_id
  from private.manager_admin_context() as context;
  if rechecked_manager_id is distinct from manager_membership_id
    or rechecked_organization_id is distinct from target_organization_id
    or rechecked_worksite_id is distinct from target_worksite_id
    or current_organization_name is null or current_worksite_name is null then
    raise exception using errcode = '42501', message = 'Pilotinstellingen kunnen niet worden bijgewerkt.';
  end if;

  select operation.* into prior_operation
  from private.manager_team_operations as operation
  where operation.request_id = client_request_id;
  if found then
    if prior_operation.actor_membership_id <> manager_membership_id
      or prior_operation.target_entity_type <> 'organization'
      or prior_operation.target_entity_id <> target_organization_id
      or prior_operation.action <> 'pilot_settings_update'
      or prior_operation.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'manager_team_request_id_reused';
    end if;
    return prior_operation.result;
  end if;

  organization_changed := current_organization_name is distinct from normalized_organization_name;
  worksite_changed := current_worksite_name is distinct from normalized_worksite_name;
  if organization_changed then
    update public.organizations
    set name = normalized_organization_name
    where id = target_organization_id;
    insert into public.audit_events (
      organization_id, actor_user_id, entity_type, entity_id, action, after_data
    ) values (
      target_organization_id, caller_id, 'organization', target_organization_id,
      'organization.settings_updated', '{"changed_fields":["name"]}'::jsonb
    );
  end if;
  if worksite_changed then
    update public.worksites
    set name = normalized_worksite_name
    where id = target_worksite_id;
    insert into public.audit_events (
      organization_id, actor_user_id, entity_type, entity_id, action, after_data
    ) values (
      target_organization_id, caller_id, 'worksite', target_worksite_id,
      'worksite.settings_updated', '{"changed_fields":["name"]}'::jsonb
    );
  end if;
  outcome := case when organization_changed or worksite_changed then 'updated' else 'unchanged' end;
  result := pg_catalog.jsonb_build_object(
    'request_id', client_request_id,
    'result_code', outcome,
    'did_change', organization_changed or worksite_changed,
    'organization_id', target_organization_id,
    'organization_name', normalized_organization_name,
    'worksite_id', target_worksite_id,
    'worksite_name', normalized_worksite_name,
    'timezone', 'Europe/Brussels'
  );
  insert into private.manager_team_operations (
    request_id, organization_id, actor_membership_id, target_entity_type,
    target_entity_id, action, payload_hash, result_code, result
  ) values (
    client_request_id, target_organization_id, manager_membership_id, 'organization',
    target_organization_id, 'pilot_settings_update', operation_hash, outcome, result
  );
  return result;
end;
$$;

create function public.get_manager_team(request_id uuid)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$ select private.get_manager_team(request_id); $$;

create function public.update_employee_profile(
  request_id uuid,
  target_membership_id uuid,
  display_name text,
  employee_code text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_employee_profile(
    request_id, target_membership_id, display_name, employee_code
  );
$$;

create function public.change_employee_membership_status(
  request_id uuid,
  target_membership_id uuid,
  action text,
  confirmed boolean
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.change_employee_membership_status(
    request_id, target_membership_id, action, confirmed
  );
$$;

create function public.update_pilot_settings(
  request_id uuid,
  organization_name text,
  worksite_name text
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.update_pilot_settings(
    request_id, organization_name, worksite_name
  );
$$;

revoke all on table private.manager_team_operations
  from public, anon, authenticated, service_role;
revoke all on function private.reject_manager_team_operation_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.manager_admin_context()
  from public, anon, authenticated, service_role;
revoke all on function private.get_manager_team(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.update_employee_profile(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.change_employee_membership_status(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.update_pilot_settings(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.get_manager_team(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.update_employee_profile(uuid, uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.change_employee_membership_status(uuid, uuid, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.update_pilot_settings(uuid, text, text)
  from public, anon, authenticated, service_role;

grant execute on function private.manager_admin_context() to authenticated;
grant execute on function private.get_manager_team(uuid) to authenticated;
grant execute on function private.update_employee_profile(uuid, uuid, text, text)
  to authenticated;
grant execute on function private.change_employee_membership_status(uuid, uuid, text, boolean)
  to authenticated;
grant execute on function private.update_pilot_settings(uuid, text, text)
  to authenticated;
grant execute on function public.get_manager_team(uuid) to authenticated;
grant execute on function public.update_employee_profile(uuid, uuid, text, text)
  to authenticated;
grant execute on function public.change_employee_membership_status(uuid, uuid, text, boolean)
  to authenticated;
grant execute on function public.update_pilot_settings(uuid, text, text)
  to authenticated;

comment on function public.get_manager_team(uuid) is
  'Bounded same-tenant employee and invitation projection for the current live manager session.';
comment on function public.update_employee_profile(uuid, uuid, text, text) is
  'Idempotent manager update of one same-tenant employee display name and optional normalized employee code.';
comment on function public.change_employee_membership_status(uuid, uuid, text, boolean) is
  'Idempotent confirmed suspension/reactivation of one same-tenant employee membership.';
comment on function public.update_pilot_settings(uuid, text, text) is
  'Idempotent update of the current organization name and sole Europe/Brussels worksite name.';

-- Keep existing invitation authorization, local delivery, and acceptance contract.
-- A conflicting optional code must never allocate a duplicate or prevent onboarding.
create or replace function private.accept_employee_invitation()
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
  conflicting_constraint text;
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

  begin
    insert into public.memberships as membership (
      organization_id, user_id, role, status, employee_code
    ) values (
      target_organization_id, caller_id, 'employee', 'active', pending_invitation.employee_code
    ) on conflict (organization_id, user_id) do update
      set status = 'active',
        employee_code = coalesce(excluded.employee_code, membership.employee_code)
      where membership.role = 'employee' and membership.status in ('invited', 'inactive')
    returning id into employee_membership_id;
    exception when unique_violation then
    get stacked diagnostics conflicting_constraint = constraint_name;
    if conflicting_constraint <> 'memberships_organization_employee_code_normalized_key' then
      raise;
    end if;
    -- Optional invitation codes are proposals, not permission. Preserve any existing
    -- unique membership code; otherwise leave unassigned for explicit manager review.
    insert into public.memberships as membership (
      organization_id, user_id, role, status, employee_code
    ) values (
      target_organization_id, caller_id, 'employee', 'active', null
    ) on conflict (organization_id, user_id) do update
      set status = 'active'
      where membership.role = 'employee' and membership.status in ('invited', 'inactive')
    returning id into employee_membership_id;
  end;
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
