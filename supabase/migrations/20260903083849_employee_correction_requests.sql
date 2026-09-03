-- Employee correction requests preserve factual time entries. Browser callers expose
-- only operation intent and employee claims; privileged implementations derive and
-- lock identity, tenant, membership, worksite, factual entries, and audit authority.
alter table public.time_entries
  add constraint time_entries_tenant_membership_worksite_id_key
  unique (organization_id, membership_id, worksite_id, id);

create table public.correction_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_membership_id uuid not null,
  worksite_id uuid not null,
  target_time_entry_id uuid,
  request_kind text not null,
  proposed_started_at timestamptz not null,
  proposed_ended_at timestamptz not null,
  original_started_at timestamptz,
  original_ended_at timestamptz,
  employee_reason text not null,
  status text not null default 'pending',
  submission_request_id uuid not null,
  withdrawal_request_id uuid,
  created_at timestamptz not null default statement_timestamp(),
  withdrawn_at timestamptz,
  resolved_at timestamptz,
  resolved_by_membership_id uuid,
  resolution_request_id uuid,
  constraint correction_requests_tenant_membership_fkey
    foreign key (organization_id, employee_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint correction_requests_tenant_worksite_fkey
    foreign key (organization_id, worksite_id)
    references public.worksites (organization_id, id) on delete restrict,
  constraint correction_requests_target_entry_fkey
    foreign key (
      organization_id, employee_membership_id, worksite_id, target_time_entry_id
    ) references public.time_entries (
      organization_id, membership_id, worksite_id, id
    ) on delete restrict,
  constraint correction_requests_resolver_tenant_fkey
    foreign key (organization_id, resolved_by_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint correction_requests_tenant_employee_id_key
    unique (organization_id, employee_membership_id, id),
  constraint correction_requests_submission_id_key
    unique (employee_membership_id, submission_request_id),
  constraint correction_requests_kind_check
    check (request_kind in ('adjustment', 'missed_entry')),
  constraint correction_requests_status_check
    check (status in ('pending', 'withdrawn', 'approved', 'rejected')),
  constraint correction_requests_reason_check check (
    employee_reason = pg_catalog.btrim(employee_reason, E' \t\n\r\f\v')
    and pg_catalog.char_length(employee_reason) between 1 and 500
  ),
  constraint correction_requests_proposal_chronology_check
    check (proposed_ended_at > proposed_started_at
      and pg_catalog.isfinite(proposed_started_at)
      and pg_catalog.isfinite(proposed_ended_at)),
  constraint correction_requests_target_snapshot_check check (
    (
      request_kind = 'adjustment'
      and target_time_entry_id is not null
      and original_started_at is not null
      and original_ended_at is not null
      and original_ended_at >= original_started_at
    )
    or (
      request_kind = 'missed_entry'
      and target_time_entry_id is null
      and original_started_at is null
      and original_ended_at is null
    )
  ),
  constraint correction_requests_status_fields_check check (
    (
      status = 'pending'
      and withdrawal_request_id is null
      and withdrawn_at is null
      and resolved_at is null
      and resolved_by_membership_id is null
      and resolution_request_id is null
    )
    or (
      status = 'withdrawn'
      and withdrawal_request_id is not null
      and withdrawn_at is not null
      and resolved_at is null
      and resolved_by_membership_id is null
      and resolution_request_id is null
    )
    or (
      status in ('approved', 'rejected')
      and withdrawal_request_id is null
      and withdrawn_at is null
      and resolved_at is not null
      and resolved_by_membership_id is not null
      and resolution_request_id is not null
    )
  )
);

comment on table public.correction_requests is
  'Employee claims requesting review; factual time entries remain unchanged until a future manager decision.';

create unique index correction_requests_one_pending_adjustment_per_entry_key
  on public.correction_requests (target_time_entry_id)
  where request_kind = 'adjustment' and status = 'pending';

create unique index correction_requests_one_pending_exact_interval_key
  on public.correction_requests (
    employee_membership_id, proposed_started_at, proposed_ended_at
  ) where status = 'pending';

create unique index correction_requests_withdrawal_id_key
  on public.correction_requests (employee_membership_id, withdrawal_request_id)
  where withdrawal_request_id is not null;

create index correction_requests_employee_created_at_idx
  on public.correction_requests (employee_membership_id, created_at desc, id desc);

create index correction_requests_employee_pending_interval_idx
  on public.correction_requests (
    employee_membership_id, proposed_started_at, proposed_ended_at
  ) where status = 'pending';

create index correction_requests_organization_id_idx
  on public.correction_requests (organization_id);

create index correction_requests_worksite_id_idx
  on public.correction_requests (worksite_id);

create index correction_requests_target_time_entry_id_idx
  on public.correction_requests (target_time_entry_id)
  where target_time_entry_id is not null;

create index correction_requests_resolved_by_membership_id_idx
  on public.correction_requests (resolved_by_membership_id)
  where resolved_by_membership_id is not null;

create table private.correction_request_operations (
  organization_id uuid not null,
  employee_membership_id uuid not null,
  request_id uuid not null,
  operation text not null,
  payload_hash bytea not null,
  correction_request_id uuid not null,
  result_code text not null,
  processed_at timestamptz not null,
  primary key (employee_membership_id, request_id),
  constraint correction_request_operations_tenant_membership_fkey
    foreign key (organization_id, employee_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint correction_request_operations_request_fkey
    foreign key (organization_id, employee_membership_id, correction_request_id)
    references public.correction_requests (
      organization_id, employee_membership_id, id
    ) on delete restrict,
  constraint correction_request_operations_operation_check
    check (operation in ('submit_adjustment', 'submit_missed_entry', 'withdraw')),
  constraint correction_request_operations_result_check check (
    (operation in ('submit_adjustment', 'submit_missed_entry') and result_code = 'submitted')
    or (operation = 'withdraw' and result_code in ('withdrawn', 'already_withdrawn'))
  )
);

comment on table private.correction_request_operations is
  'Immutable hashes and outcomes for correction request idempotency; no browser access.';

create index correction_request_operations_request_id_idx
  on private.correction_request_operations (correction_request_id);

alter table private.correction_request_operations enable row level security;

-- Protect the submitted claim and creation snapshot even against accidental
-- owner-side updates in a later migration. Decisions may only change status fields.
create function private.guard_correction_request_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('DELETE', 'TRUNCATE') then
    raise exception using errcode = '55000', message = 'correction_request_immutable';
  end if;
  if (pg_catalog.to_jsonb(new) - array[
    'status', 'withdrawal_request_id', 'withdrawn_at', 'resolved_at',
    'resolved_by_membership_id', 'resolution_request_id'
  ]) is distinct from (pg_catalog.to_jsonb(old) - array[
    'status', 'withdrawal_request_id', 'withdrawn_at', 'resolved_at',
    'resolved_by_membership_id', 'resolution_request_id'
  ]) then
    raise exception using errcode = '55000', message = 'correction_request_immutable';
  end if;
  if old.status <> 'pending' and new is distinct from old then
    raise exception using errcode = '55000', message = 'correction_request_immutable';
  end if;
  return new;
end;
$$;

create trigger correction_request_immutable
before update or delete on public.correction_requests
for each row execute function private.guard_correction_request_immutability();

create trigger correction_request_no_truncate
before truncate on public.correction_requests
for each statement execute function private.guard_correction_request_immutability();

create function private.guard_correction_operation_immutability()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'correction_operation_immutable';
end;
$$;

create trigger correction_operation_immutable
before update or delete on private.correction_request_operations
for each row execute function private.guard_correction_operation_immutability();

create trigger correction_operation_no_truncate
before truncate on private.correction_request_operations
for each statement execute function private.guard_correction_operation_immutability();

revoke all on function private.guard_correction_request_immutability()
  from public, anon, authenticated, service_role;
revoke all on function private.guard_correction_operation_immutability()
  from public, anon, authenticated, service_role;

create function private.resolve_brussels_local(
  local_value text,
  occurrence text
)
returns timestamptz
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  parsed_local timestamp without time zone;
  default_candidate timestamptz;
  candidates timestamptz[] := array[]::timestamptz[];
  candidate timestamptz;
  nearby_instant timestamptz;
begin
  occurrence := nullif(occurrence, '');
  if local_value is null
    or local_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]{1,6})?)?$'
    or occurrence is not null and occurrence not in ('earlier', 'later') then
    raise exception using errcode = '22007', message = 'correction_invalid_local_time';
  end if;

  begin
    parsed_local := local_value::timestamp without time zone;
  exception when others then
    raise exception using errcode = '22007', message = 'correction_invalid_local_time';
  end;

  if pg_catalog.to_char(parsed_local, 'YYYY-MM-DD"T"HH24:MI') <> left(local_value, 16)
    or (length(local_value) >= 19 and
      pg_catalog.to_char(parsed_local, 'SS') <> substring(local_value from 18 for 2)) then
    raise exception using errcode = '22007', message = 'correction_invalid_local_time';
  end if;

  default_candidate := parsed_local at time zone 'Europe/Brussels';
  -- Derive both nearby offsets from tzdata, including historical offsets that
  -- were not whole hours. The server/session TimeZone never interprets input.
  foreach nearby_instant in array array[
    default_candidate - interval '1 day',
    default_candidate,
    default_candidate + interval '1 day'
  ] loop
    candidate := (parsed_local - (
      (nearby_instant at time zone 'Europe/Brussels')
      - (nearby_instant at time zone 'UTC')
    )) at time zone 'UTC';
    if candidate at time zone 'Europe/Brussels' = parsed_local
      and not candidate = any(candidates) then
      candidates := pg_catalog.array_append(candidates, candidate);
    end if;
  end loop;

  if pg_catalog.cardinality(candidates) = 0 then
    raise exception using errcode = '22008', message = 'correction_nonexistent_local_time';
  end if;

  if pg_catalog.cardinality(candidates) > 1 then
    if occurrence is null then
      raise exception using errcode = '22023', message = 'correction_ambiguous_local_time';
    end if;
    if occurrence = 'earlier' then
      select pg_catalog.min(value) into candidate from pg_catalog.unnest(candidates) as value;
    else
      select pg_catalog.max(value) into candidate from pg_catalog.unnest(candidates) as value;
    end if;
    return candidate;
  end if;

  return candidates[1];
end;
$$;

create function private.can_read_own_correction_request(
  target_organization_id uuid,
  target_membership_id uuid
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
    join auth.users as auth_user on auth_user.id = membership.user_id
    join auth.sessions as auth_session on auth_session.user_id = auth_user.id
    where membership.id = target_membership_id
      and membership.organization_id = target_organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'employee'
      and membership.status = 'active'
      and (select pg_catalog.count(*) from public.memberships as active_membership
        where active_membership.user_id = membership.user_id
          and active_membership.status = 'active') = 1
      and organization.lifecycle_status in ('research_pilot', 'paid_beta')
      and auth_user.email_confirmed_at is not null
      and auth_user.deleted_at is null
      and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.now())
      and auth_session.id::text = (auth.jwt() ->> 'session_id')
      and (auth_session.not_after is null or auth_session.not_after > pg_catalog.now())
  );
$$;

create function private.submit_employee_correction_request(
  client_request_id uuid,
  client_request_kind text,
  client_target_time_entry_id uuid,
  client_proposed_start_local text,
  client_proposed_start_occurrence text,
  client_proposed_end_local text,
  client_proposed_end_occurrence text,
  client_employee_reason text
)
returns table (
  request_id uuid,
  correction_request_id uuid,
  result_code text,
  request_status text,
  did_create boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  session_expires_at timestamptz;
  active_count bigint;
  worksite_count bigint;
  target_organization_id uuid;
  target_membership_id uuid;
  target_worksite_id uuid;
  target_entry public.time_entries%rowtype;
  prior_operation private.correction_request_operations%rowtype;
  created_request public.correction_requests%rowtype;
  operation_name text;
  payload_hash bytea;
  normalized_reason text;
  proposed_start timestamptz;
  proposed_end timestamptz;
  operation_time timestamptz;
begin
  if client_request_id is null
    or client_request_kind is null
    or client_request_kind not in ('adjustment', 'missed_entry')
    or client_employee_reason is null then
    raise exception using errcode = '22023', message = 'correction_invalid_request';
  end if;

  if (client_request_kind = 'adjustment') <> (client_target_time_entry_id is not null) then
    raise exception using errcode = '22023', message = 'correction_invalid_target';
  end if;

  normalized_reason := pg_catalog.btrim(client_employee_reason, E' \t\n\r\f\v');
  if pg_catalog.char_length(normalized_reason) not between 1 and 500 then
    raise exception using errcode = '22023', message = 'correction_invalid_reason';
  end if;

  begin
    proposed_start := private.resolve_brussels_local(
      client_proposed_start_local, client_proposed_start_occurrence
    );
  exception when sqlstate '22007' or sqlstate '22008' or sqlstate '22023' then
    raise exception using errcode = sqlstate, message = sqlerrm, detail = 'proposed_start_local';
  end;
  begin
    proposed_end := private.resolve_brussels_local(
      client_proposed_end_local, client_proposed_end_occurrence
    );
  exception when sqlstate '22007' or sqlstate '22008' or sqlstate '22023' then
    raise exception using errcode = sqlstate, message = sqlerrm, detail = 'proposed_end_local';
  end;

  if proposed_end <= proposed_start then
    raise exception using errcode = '22023', message = 'correction_invalid_interval';
  end if;

  operation_name := case client_request_kind
    when 'adjustment' then 'submit_adjustment'
    else 'submit_missed_entry'
  end;
  payload_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      operation_name,
      client_target_time_entry_id,
      client_proposed_start_local,
      client_proposed_start_occurrence,
      client_proposed_end_local,
      client_proposed_end_occurrence,
      client_employee_reason
    )::text,
    'UTF8'
  ));

  select auth_session.not_after into session_expires_at
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (auth_session.not_after is null or auth_session.not_after > pg_catalog.clock_timestamp())
  for share of auth_user, auth_session;
  if caller_id is null or not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  -- Same order as clock functions: Auth rows, caller advisory lock, memberships,
  -- organization, worksites, idempotency row, then factual/request rows.
  perform pg_catalog.pg_advisory_xact_lock(17031, pg_catalog.hashtext(caller_id::text));
  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for update;

  select pg_catalog.count(*) into active_count
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active';
  if active_count <> 1 then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  select membership.id, membership.organization_id
  into target_membership_id, target_organization_id
  from public.memberships as membership
  where membership.user_id = caller_id
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  select operation.* into prior_operation
  from private.correction_request_operations as operation
  where operation.employee_membership_id = target_membership_id
    and operation.request_id = client_request_id;
  if found then
    if prior_operation.operation <> operation_name
      or prior_operation.payload_hash <> payload_hash then
      raise exception using errcode = '22023', message = 'correction_request_id_reused';
    end if;
    return query select prior_operation.request_id,
      prior_operation.correction_request_id, prior_operation.result_code,
      'pending'::text, true;
    return;
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;
  if proposed_end >= operation_time then
    raise exception using errcode = '22023', message = 'correction_interval_not_past';
  end if;

  -- Advisory serialization matches time clock, then rows are locked before all
  -- ownership, closed-state, overlap, and snapshot checks.
  perform entry.id from public.time_entries as entry
  where entry.membership_id = target_membership_id
  order by entry.id for update;

  if client_request_kind = 'adjustment' then
    select entry.* into target_entry
    from public.time_entries as entry
    where entry.id = client_target_time_entry_id
      and entry.organization_id = target_organization_id
      and entry.membership_id = target_membership_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is not null;
    if not found then
      raise exception using errcode = '22023', message = 'correction_invalid_target';
    end if;
    if proposed_start = target_entry.started_at and proposed_end = target_entry.ended_at then
      raise exception using errcode = '22023', message = 'correction_unchanged';
    end if;
  else
    target_entry := null;
  end if;

  if exists (
    select 1 from public.time_entries as entry
    where entry.membership_id = target_membership_id
      and (client_target_time_entry_id is null or entry.id <> client_target_time_entry_id)
      and entry.started_at < proposed_end
      and coalesce(entry.ended_at, 'infinity'::timestamptz) > proposed_start
  ) then
    raise exception using errcode = '22023', message = 'correction_factual_overlap';
  end if;

  perform request.id from public.correction_requests as request
  where request.employee_membership_id = target_membership_id
  order by request.id for update;
  if exists (
    select 1 from public.correction_requests as request
    where request.employee_membership_id = target_membership_id
      and request.status = 'pending'
      and (
        request.target_time_entry_id = client_target_time_entry_id
        or (request.proposed_started_at < proposed_end
          and request.proposed_ended_at > proposed_start)
      )
  ) then
    raise exception using errcode = '22023', message = 'correction_pending_conflict';
  end if;

  insert into public.correction_requests (
    organization_id, employee_membership_id, worksite_id,
    target_time_entry_id, request_kind, proposed_started_at,
    proposed_ended_at, original_started_at, original_ended_at,
    employee_reason, submission_request_id, created_at
  ) values (
    target_organization_id, target_membership_id, target_worksite_id,
    client_target_time_entry_id, client_request_kind, proposed_start,
    proposed_end, target_entry.started_at, target_entry.ended_at,
    normalized_reason, client_request_id, operation_time
  ) returning * into created_request;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action, after_data
  ) values (
    target_organization_id, caller_id, 'correction_request', created_request.id,
    'correction_request.submitted', '{"status":"pending"}'::jsonb
  );

  insert into private.correction_request_operations (
    organization_id, employee_membership_id, request_id, operation,
    payload_hash, correction_request_id, result_code, processed_at
  ) values (
    target_organization_id, target_membership_id, client_request_id,
    operation_name, payload_hash, created_request.id, 'submitted', operation_time
  );

  return query select client_request_id, created_request.id, 'submitted'::text,
    'pending'::text, true;
end;
$$;

create function private.withdraw_employee_correction_request(
  client_request_id uuid,
  client_correction_request_id uuid
)
returns table (
  request_id uuid,
  correction_request_id uuid,
  result_code text,
  request_status text,
  did_withdraw boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  session_expires_at timestamptz;
  active_count bigint;
  worksite_count bigint;
  target_organization_id uuid;
  target_membership_id uuid;
  target_request public.correction_requests%rowtype;
  prior_operation private.correction_request_operations%rowtype;
  payload_hash bytea;
  operation_time timestamptz;
begin
  if client_request_id is null or client_correction_request_id is null then
    raise exception using errcode = '22023', message = 'correction_invalid_request';
  end if;

  payload_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array('withdraw', client_correction_request_id)::text,
    'UTF8'
  ));

  select auth_session.not_after into session_expires_at
  from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_user.email_confirmed_at is not null
    and auth_user.deleted_at is null
    and (auth_user.banned_until is null or auth_user.banned_until <= pg_catalog.clock_timestamp())
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
    and (auth_session.not_after is null or auth_session.not_after > pg_catalog.clock_timestamp())
  for share of auth_user, auth_session;
  if caller_id is null or not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(17031, pg_catalog.hashtext(caller_id::text));
  perform membership.id from public.memberships as membership
  where membership.user_id = caller_id order by membership.id for update;

  select pg_catalog.count(*) into active_count
  from public.memberships as membership
  where membership.user_id = caller_id and membership.status = 'active';
  if active_count <> 1 then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  select membership.id, membership.organization_id
  into target_membership_id, target_organization_id
  from public.memberships as membership
  where membership.user_id = caller_id
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id
    and organization.lifecycle_status in ('research_pilot', 'paid_beta')
  for share;
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;

  select pg_catalog.count(*) into worksite_count
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;
  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  select operation.* into prior_operation
  from private.correction_request_operations as operation
  where operation.employee_membership_id = target_membership_id
    and operation.request_id = client_request_id;
  if found then
    if prior_operation.operation <> 'withdraw'
      or prior_operation.payload_hash <> payload_hash then
      raise exception using errcode = '22023', message = 'correction_request_id_reused';
    end if;
    select request.* into target_request
    from public.correction_requests as request
    where request.id = prior_operation.correction_request_id;
    return query select prior_operation.request_id,
      prior_operation.correction_request_id, prior_operation.result_code,
      'withdrawn'::text, prior_operation.result_code = 'withdrawn';
    return;
  end if;

  select request.* into target_request
  from public.correction_requests as request
  where request.id = client_correction_request_id
    and request.organization_id = target_organization_id
    and request.employee_membership_id = target_membership_id
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  operation_time := pg_catalog.clock_timestamp();
  if session_expires_at is not null and session_expires_at <= operation_time then
    raise exception using errcode = '42501', message = 'Correctieaanvraag kan niet worden verwerkt.';
  end if;

  if target_request.status = 'withdrawn' then
    insert into private.correction_request_operations (
      organization_id, employee_membership_id, request_id, operation,
      payload_hash, correction_request_id, result_code, processed_at
    ) values (
      target_organization_id, target_membership_id, client_request_id, 'withdraw',
      payload_hash, target_request.id, 'already_withdrawn', operation_time
    );
    return query select client_request_id, target_request.id,
      'already_withdrawn'::text, 'withdrawn'::text, false;
    return;
  end if;

  if target_request.status <> 'pending' then
    raise exception using errcode = '22023', message = 'correction_not_pending';
  end if;

  update public.correction_requests
  set status = 'withdrawn', withdrawal_request_id = client_request_id,
    withdrawn_at = operation_time
  where id = target_request.id
  returning * into target_request;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action,
    before_data, after_data
  ) values (
    target_organization_id, caller_id, 'correction_request', target_request.id,
    'correction_request.withdrawn', '{"status":"pending"}'::jsonb,
    '{"status":"withdrawn"}'::jsonb
  );

  insert into private.correction_request_operations (
    organization_id, employee_membership_id, request_id, operation,
    payload_hash, correction_request_id, result_code, processed_at
  ) values (
    target_organization_id, target_membership_id, client_request_id, 'withdraw',
    payload_hash, target_request.id, 'withdrawn', operation_time
  );

  return query select client_request_id, target_request.id, 'withdrawn'::text,
    'withdrawn'::text, true;
end;
$$;

create function private.get_employee_correction_requests()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  context_organization_id uuid;
  context_role text;
  target_membership_id uuid;
  target_worksite_id uuid;
  worksite_count bigint;
  entries jsonb;
  requests jsonb;
begin
  select context.organization_id, context.membership_role
  into context_organization_id, context_role
  from private.get_auth_context() as context
  where context.authorization_state = 'authorized';
  if not found or context_role <> 'employee' then
    raise exception using errcode = '42501', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;

  select membership.id into target_membership_id
  from public.memberships as membership
  where membership.organization_id = context_organization_id
    and membership.user_id = (select auth.uid())
    and membership.role = 'employee'
    and membership.status = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = context_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Correctieaanvragen kunnen niet worden geladen.';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', entry.id,
      'worksite_id', entry.worksite_id,
      'started_at', entry.started_at,
      'ended_at', entry.ended_at
    ) order by entry.started_at desc, entry.id desc),
    '[]'::jsonb
  ) into entries
  from (
    select entry.* from public.time_entries as entry
    where entry.organization_id = context_organization_id
      and entry.membership_id = target_membership_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is not null
    order by entry.started_at desc, entry.id desc
    limit 20
  ) as entry;

  select coalesce(
    pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'id', request.id,
      'request_kind', request.request_kind,
      'target_time_entry_id', request.target_time_entry_id,
      'proposed_started_at', request.proposed_started_at,
      'proposed_ended_at', request.proposed_ended_at,
      'employee_reason', request.employee_reason,
      'status', request.status,
      'created_at', request.created_at,
      'withdrawn_at', request.withdrawn_at
    ) order by request.created_at desc, request.id desc),
    '[]'::jsonb
  ) into requests
  from (
    select request.* from public.correction_requests as request
    where request.organization_id = context_organization_id
      and request.employee_membership_id = target_membership_id
    order by request.created_at desc, request.id desc
    limit 50
  ) as request;

  return pg_catalog.jsonb_build_object(
    'server_time', pg_catalog.now(),
    'timezone', 'Europe/Brussels',
    'entries', entries,
    'requests', requests
  );
end;
$$;

create function public.submit_employee_correction_request(
  request_id uuid,
  request_kind text,
  target_time_entry_id text,
  proposed_start_local text,
  proposed_start_occurrence text,
  proposed_end_local text,
  proposed_end_occurrence text,
  employee_reason text
)
returns table (
  request_id uuid,
  correction_request_id uuid,
  result_code text,
  request_status text,
  did_create boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.submit_employee_correction_request(
    $1,
    $2,
    case when nullif($3, '') is null then null else $3::uuid end,
    $4,
    $5,
    $6,
    $7,
    $8
  );
$$;

create function public.withdraw_employee_correction_request(
  request_id uuid,
  correction_request_id uuid
)
returns table (
  request_id uuid,
  correction_request_id uuid,
  result_code text,
  request_status text,
  did_withdraw boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.withdraw_employee_correction_request($1, $2);
$$;

create function public.get_employee_correction_requests()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$ select private.get_employee_correction_requests(); $$;

revoke all on table public.correction_requests
  from public, anon, authenticated, service_role;
grant select on table public.correction_requests to authenticated, service_role;

revoke all on table private.correction_request_operations
  from public, anon, authenticated, service_role;

revoke all on function private.resolve_brussels_local(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.can_read_own_correction_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.submit_employee_correction_request(uuid, text, uuid, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.withdraw_employee_correction_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.get_employee_correction_requests()
  from public, anon, authenticated, service_role;
revoke all on function public.submit_employee_correction_request(uuid, text, text, text, text, text, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.withdraw_employee_correction_request(uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_employee_correction_requests()
  from public, anon, authenticated, service_role;

grant execute on function private.can_read_own_correction_request(uuid, uuid)
  to authenticated;
grant execute on function private.submit_employee_correction_request(uuid, text, uuid, text, text, text, text, text)
  to authenticated;
grant execute on function private.withdraw_employee_correction_request(uuid, uuid)
  to authenticated;
grant execute on function private.get_employee_correction_requests()
  to authenticated;
grant execute on function public.submit_employee_correction_request(uuid, text, text, text, text, text, text, text)
  to authenticated;
grant execute on function public.withdraw_employee_correction_request(uuid, uuid)
  to authenticated;
grant execute on function public.get_employee_correction_requests()
  to authenticated;

alter table public.correction_requests enable row level security;

create policy correction_requests_select_own_active_employee
on public.correction_requests
for select
to authenticated
using (
  (select private.can_read_own_correction_request(
    organization_id, employee_membership_id
  ))
);

comment on function public.submit_employee_correction_request(uuid, text, text, text, text, text, text, text) is
  'Idempotently submit an employee adjustment or missed-entry claim using explicit Brussels wall-clock values.';
comment on function public.withdraw_employee_correction_request(uuid, uuid) is
  'Idempotently withdraw the current employee own pending correction request.';
comment on function public.get_employee_correction_requests() is
  'Return recent closed entries and own correction requests for the current active employee.';
