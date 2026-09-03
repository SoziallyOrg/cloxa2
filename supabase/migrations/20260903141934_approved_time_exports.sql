-- Manager-confirmed factual exports. Public metadata is tenant-scoped and read-only;
-- exact rows and idempotency outcomes stay in private schema. No artifact is stored.
create table public.time_exports (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  worksite_id uuid not null,
  schema_version text not null,
  selection_rule text not null,
  timezone text not null,
  period_start_local date not null,
  period_end_local date not null,
  created_at timestamptz not null,
  record_count integer not null,
  employee_count integer not null,
  total_duration_microseconds numeric(30, 0) not null,
  dataset_sha256 text not null,
  constraint time_exports_organization_id_id_key unique (organization_id, id),
  constraint time_exports_worksite_fkey foreign key (organization_id, worksite_id)
    references public.worksites (organization_id, id) on delete restrict,
  constraint time_exports_schema_version_check check (schema_version = 'cloxa.time-export.v1'),
  constraint time_exports_selection_rule_check check (selection_rule = 'brussels-start-date.v1'),
  constraint time_exports_timezone_check check (timezone = 'Europe/Brussels'),
  constraint time_exports_period_check check (
    period_end_local >= period_start_local
    and period_end_local - period_start_local <= 30
  ),
  constraint time_exports_record_count_check check (record_count between 1 and 10000),
  constraint time_exports_employee_count_check check (
    employee_count between 1 and record_count
  ),
  constraint time_exports_duration_check check (total_duration_microseconds > 0),
  constraint time_exports_hash_check check (dataset_sha256 ~ '^[0-9a-f]{64}$')
);

comment on table public.time_exports is
  'Manager-visible metadata for fixed export snapshots. Retention and controlled deletion remain future work.';

create index time_exports_organization_created_at_idx
  on public.time_exports (organization_id, created_at desc, id desc);
create index time_exports_worksite_period_idx
  on public.time_exports (worksite_id, period_start_local, period_end_local);

create table private.time_export_rows (
  export_id uuid not null,
  organization_id uuid not null,
  row_ordinal integer not null,
  source_time_entry_id uuid not null,
  source_time_entry_version integer not null,
  employee_code text,
  employee_display_name text,
  worksite_id uuid not null,
  worksite_name text not null,
  started_at_utc text not null,
  ended_at_utc text not null,
  started_at_brussels text not null,
  ended_at_brussels text not null,
  duration_microseconds numeric(30, 0) not null,
  factual_origin text not null,
  last_correction_request_id uuid,
  primary key (export_id, row_ordinal),
  constraint time_export_rows_export_fkey foreign key (organization_id, export_id)
    references public.time_exports (organization_id, id) on delete restrict,
  constraint time_export_rows_ordinal_check check (row_ordinal between 1 and 10000),
  constraint time_export_rows_version_check check (source_time_entry_version >= 1),
  constraint time_export_rows_worksite_fkey foreign key (organization_id, worksite_id)
    references public.worksites (organization_id, id) on delete restrict,
  constraint time_export_rows_duration_check check (duration_microseconds > 0),
  constraint time_export_rows_origin_check check (
    factual_origin in ('clock', 'approved_missed_entry')
  )
);

comment on table private.time_export_rows is
  'Fixed factual row values captured for one manager-confirmed export; no browser access.';

create unique index time_export_rows_source_version_key
  on private.time_export_rows (export_id, source_time_entry_id, source_time_entry_version);
create index time_export_rows_organization_idx
  on private.time_export_rows (organization_id, export_id);

create table private.time_export_creation_operations (
  request_id uuid primary key,
  organization_id uuid not null,
  manager_membership_id uuid not null,
  payload_hash bytea not null,
  result_code text not null,
  export_id uuid,
  processed_at timestamptz not null,
  constraint time_export_operations_manager_fkey
    foreign key (organization_id, manager_membership_id)
    references public.memberships (organization_id, id) on delete restrict,
  constraint time_export_operations_export_fkey
    foreign key (organization_id, export_id)
    references public.time_exports (organization_id, id) on delete restrict,
  constraint time_export_operations_hash_check check (
    pg_catalog.octet_length(payload_hash) = 32
  ),
  constraint time_export_operations_result_check check (
    (result_code = 'created' and export_id is not null)
    or (result_code in (
      'no_records', 'open_entry', 'pending_correction',
      'row_limit', 'artifact_too_large'
    ) and export_id is null)
  )
);

comment on table private.time_export_creation_operations is
  'Fixed global operation UUID, manager/payload binding, and original export-creation outcome.';

create index time_export_creation_operations_manager_idx
  on private.time_export_creation_operations (manager_membership_id, processed_at desc);
create index time_export_creation_operations_export_idx
  on private.time_export_creation_operations (export_id)
  where export_id is not null;

create function private.reject_time_export_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'time_export_snapshot_fixed';
  return null;
end;
$$;

create trigger time_exports_reject_mutation
before update or delete on public.time_exports
for each row execute function private.reject_time_export_mutation();
create trigger time_exports_reject_truncate
before truncate on public.time_exports
for each statement execute function private.reject_time_export_mutation();
create trigger time_export_rows_reject_mutation
before update or delete on private.time_export_rows
for each row execute function private.reject_time_export_mutation();
create trigger time_export_rows_reject_truncate
before truncate on private.time_export_rows
for each statement execute function private.reject_time_export_mutation();
create trigger time_export_operations_reject_mutation
before update or delete on private.time_export_creation_operations
for each row execute function private.reject_time_export_mutation();
create trigger time_export_operations_reject_truncate
before truncate on private.time_export_creation_operations
for each statement execute function private.reject_time_export_mutation();

create function private.export_local_date(raw_value text)
returns date
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  parsed date;
begin
  if raw_value is null or raw_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end if;
  begin
    parsed := raw_value::date;
  exception when datetime_field_overflow or invalid_datetime_format then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end;
  if pg_catalog.to_char(parsed, 'YYYY-MM-DD') <> raw_value then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end if;
  return parsed;
end;
$$;

create function private.format_export_utc(value timestamptz)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.to_char($1 at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

create function private.format_export_brussels(value timestamptz)
returns text
language sql
immutable
strict
security invoker
set search_path = ''
as $$
  select pg_catalog.to_char(
    $1 at time zone 'Europe/Brussels', 'YYYY-MM-DD"T"HH24:MI:SS.US'
  ) || case when offset_seconds < 0 then '-' else '+' end
    || pg_catalog.lpad((pg_catalog.abs(offset_seconds) / 3600)::text, 2, '0')
    || ':'
    || pg_catalog.lpad(((pg_catalog.abs(offset_seconds) % 3600) / 60)::text, 2, '0')
    || case when pg_catalog.abs(offset_seconds) % 60 <> 0 then
      ':' || pg_catalog.lpad((pg_catalog.abs(offset_seconds) % 60)::text, 2, '0')
      else '' end
  from (
    select extract(epoch from (
      ($1 at time zone 'Europe/Brussels') - ($1 at time zone 'UTC')
    ))::integer as offset_seconds
  ) as offset_value;
$$;

create function private.time_export_manifest(target_export public.time_exports)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'schema_version', target_export.schema_version,
    'export_id', target_export.id,
    'organization_id', target_export.organization_id,
    'worksite_id', target_export.worksite_id,
    'timezone', target_export.timezone,
    'period_start_local', target_export.period_start_local,
    'period_end_local', target_export.period_end_local,
    'created_at_utc', private.format_export_utc(target_export.created_at),
    'record_count', target_export.record_count,
    'employee_count', target_export.employee_count,
    'total_duration_microseconds', target_export.total_duration_microseconds::text,
    'dataset_sha256', target_export.dataset_sha256,
    'selection_rule', target_export.selection_rule
  );
$$;

create function private.selected_time_export_records(
  organization_id uuid, worksite_id uuid, utc_start timestamptz, utc_end timestamptz
)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row_ordinal', selected.row_ordinal,
    'source_time_entry_id', selected.source_time_entry_id,
    'source_time_entry_version', selected.source_time_entry_version,
    'employee_code', selected.employee_code,
    'employee_display_name', selected.employee_display_name,
    'worksite_id', selected.worksite_id,
    'worksite_name', selected.worksite_name,
    'started_at_utc', selected.started_at_utc,
    'ended_at_utc', selected.ended_at_utc,
    'started_at_brussels', selected.started_at_brussels,
    'ended_at_brussels', selected.ended_at_brussels,
    'duration_microseconds', selected.duration_microseconds::text,
    'factual_origin', selected.factual_origin,
    'last_correction_request_id', selected.last_correction_request_id
  ) order by selected.row_ordinal)
  from (
    select row_number() over (
      order by entry.membership_id, entry.started_at, entry.ended_at, entry.id
    )::integer as row_ordinal,
      entry.id as source_time_entry_id, entry.version as source_time_entry_version,
      membership.employee_code, profile.display_name as employee_display_name,
      entry.worksite_id, worksite.name as worksite_name,
      private.format_export_utc(entry.started_at) as started_at_utc,
      private.format_export_utc(entry.ended_at) as ended_at_utc,
      private.format_export_brussels(entry.started_at) as started_at_brussels,
      private.format_export_brussels(entry.ended_at) as ended_at_brussels,
      (extract(epoch from (entry.ended_at - entry.started_at)) * 1000000)::numeric(30, 0)
        as duration_microseconds,
      entry.origin as factual_origin,
      entry.last_correction_request_id
    from public.time_entries as entry
    join public.memberships as membership on membership.id = entry.membership_id
      and membership.organization_id = $1
    left join public.profiles as profile on profile.user_id = membership.user_id
    join public.worksites as worksite on worksite.id = entry.worksite_id
    where entry.organization_id = $1
      and entry.worksite_id = $2
      and entry.ended_at is not null
      and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
      and entry.ended_at > entry.started_at
      and entry.started_at >= $3 and entry.started_at < $4
  ) as selected;
$$;

create function private.preview_time_export(
  period_start_local text,
  period_end_local text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := private.manager_review_organization();
  target_worksite_id uuid;
  worksite_count bigint;
  start_date date := private.export_local_date(period_start_local);
  end_date date := private.export_local_date(period_end_local);
  utc_start timestamptz;
  utc_end timestamptz;
  local_today date := (pg_catalog.clock_timestamp() at time zone 'Europe/Brussels')::date;
  records bigint;
  employees bigint;
  duration numeric(30, 0);
  estimated_artifact_bytes numeric;
  missing_codes bigint;
  missing_names bigint;
  has_open boolean;
  has_pending boolean;
  blockers jsonb;
  warnings jsonb;
begin
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Exportvoorbeeld kan niet worden geladen.';
  end if;
  if end_date < start_date or end_date - start_date > 30 or end_date > local_today then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end if;
  utc_start := start_date::timestamp at time zone 'Europe/Brussels';
  utc_end := (end_date + 1)::timestamp at time zone 'Europe/Brussels';
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
    into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Exportvoorbeeld kan niet worden geladen.';
  end if;

  select pg_catalog.count(*), pg_catalog.count(distinct entry.membership_id),
    coalesce(pg_catalog.sum(
      extract(epoch from (entry.ended_at - entry.started_at)) * 1000000
    ), 0),
    pg_catalog.count(*) filter (where membership.employee_code is null),
    pg_catalog.count(*) filter (where profile.display_name is null),
    coalesce(pg_catalog.sum(
      2048 + 6 * (
        pg_catalog.octet_length(coalesce(membership.employee_code, ''))
        + pg_catalog.octet_length(coalesce(profile.display_name, ''))
        + pg_catalog.octet_length(worksite.name)
      )
    ), 0)
  into records, employees, duration, missing_codes, missing_names,
    estimated_artifact_bytes
  from public.time_entries as entry
  join public.memberships as membership on membership.id = entry.membership_id
    and membership.organization_id = target_organization_id
  left join public.profiles as profile on profile.user_id = membership.user_id
  join public.worksites as worksite on worksite.id = entry.worksite_id
    and worksite.organization_id = target_organization_id
  where entry.organization_id = target_organization_id
    and entry.worksite_id = target_worksite_id
    and entry.ended_at is not null
    and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
    and entry.ended_at > entry.started_at
    and entry.started_at >= utc_start and entry.started_at < utc_end;

  select exists (
    select 1 from public.time_entries as entry
    where entry.organization_id = target_organization_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is null and entry.started_at < utc_end
  ) into has_open;
  select exists (
    select 1 from public.correction_requests as request
    where request.organization_id = target_organization_id
      and request.worksite_id = target_worksite_id and request.status = 'pending'
      and (
        (request.target_time_entry_id is not null and exists (
          select 1 from public.time_entries as entry
          where entry.id = request.target_time_entry_id
            and entry.organization_id = target_organization_id
            and entry.worksite_id = target_worksite_id
            and entry.ended_at is not null
            and entry.ended_at > entry.started_at
            and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
            and entry.started_at >= utc_start and entry.started_at < utc_end
        ))
        or (request.proposed_started_at < utc_end and request.proposed_ended_at > utc_start)
      )
  ) into has_pending;

  select coalesce(pg_catalog.jsonb_agg(code order by ordinal), '[]'::jsonb)
  into blockers
  from (values
    (1, case when records = 0 then 'no_records' end),
    (2, case when has_open then 'open_entry' end),
    (3, case when has_pending then 'pending_correction' end),
    (4, case when records > 10000 then 'row_limit' end),
    (5, case when estimated_artifact_bytes + 8192 > 10485760
      then 'artifact_too_large' end)
  ) as values_list(ordinal, code)
  where code is not null;
  select coalesce(pg_catalog.jsonb_agg(code order by ordinal), '[]'::jsonb)
  into warnings
  from (values
    (1, case when missing_codes > 0 then 'missing_employee_code' end),
    (2, case when missing_names > 0 then 'missing_display_name' end)
  ) as values_list(ordinal, code)
  where code is not null;

  return pg_catalog.jsonb_build_object(
    'timezone', 'Europe/Brussels',
    'period_start_local', start_date,
    'period_end_local', end_date,
    'utc_start_inclusive', private.format_export_utc(utc_start),
    'utc_end_exclusive', private.format_export_utc(utc_end),
    'record_count', records,
    'employee_count', employees,
    'total_duration_microseconds', duration::text,
    'blockers', blockers,
    'warnings', warnings,
    'records', case when records <= 10000 and estimated_artifact_bytes + 8192 <= 10485760
      then coalesce(private.selected_time_export_records(
        target_organization_id, target_worksite_id, utc_start, utc_end
      ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

create function private.create_time_export(
  request_id uuid,
  period_start_local text,
  period_end_local text,
  confirmed boolean
)
returns table (result_code text, did_create boolean, export_id uuid, manifest jsonb)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  caller_id uuid := auth.uid();
  target_organization_id uuid := private.manager_review_organization();
  target_worksite_id uuid;
  manager_membership_id uuid;
  worksite_count bigint;
  start_date date := private.export_local_date(period_start_local);
  end_date date := private.export_local_date(period_end_local);
  local_today date := (pg_catalog.clock_timestamp() at time zone 'Europe/Brussels')::date;
  utc_start timestamptz;
  utc_end timestamptz;
  operation_hash bytea;
  prior_operation private.time_export_creation_operations%rowtype;
  created_export public.time_exports%rowtype;
  operation_time timestamptz;
  employee_user_id uuid;
  records integer;
  employees integer;
  total_duration numeric(30, 0);
  estimated_artifact_bytes numeric;
  has_open boolean;
  has_pending boolean;
  outcome text;
  canonical_rows jsonb;
  canonical_input jsonb;
  dataset_hash text;
begin
  if request_id is null or confirmed is distinct from true
    or target_organization_id is null then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;
  if end_date < start_date or end_date - start_date > 30 or end_date > local_today then
    raise exception using errcode = '22023', message = 'export_invalid_period';
  end if;
  utc_start := start_date::timestamp at time zone 'Europe/Brussels';
  utc_end := (end_date + 1)::timestamp at time zone 'Europe/Brussels';

  -- Keep Auth rows locked throughout the protected mutation.
  perform auth_user.id from auth.users as auth_user
  join auth.sessions as auth_session on auth_session.user_id = auth_user.id
  where auth_user.id = caller_id
    and auth_session.id::text = (auth.jwt() ->> 'session_id')
  for share of auth_user, auth_session;
  if not found then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  -- Global operation UUID first. Every employee uses the existing 17031 clock and
  -- correction namespace, ordered by lock key then UUID to avoid multi-row deadlocks.
  perform pg_catalog.pg_advisory_xact_lock(17051, pg_catalog.hashtext(request_id::text));
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
  perform membership.id from public.memberships as membership
  where membership.organization_id = target_organization_id
  order by membership.id for share;
  perform organization.id from public.organizations as organization
  where organization.id = target_organization_id for share;
  perform worksite.id from public.worksites as worksite
  where worksite.organization_id = target_organization_id
  order by worksite.id for share;

  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;
  select membership.id into manager_membership_id
  from public.memberships as membership
  where membership.organization_id = target_organization_id
    and membership.user_id = caller_id
    and membership.role = 'manager' and membership.status = 'active';
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id
  from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if manager_membership_id is null or worksite_count <> 1 then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  operation_hash := pg_catalog.sha256(pg_catalog.convert_to(
    pg_catalog.jsonb_build_array(
      caller_id, period_start_local, period_end_local, confirmed
    )::text, 'UTF8'
  ));
  select operation.* into prior_operation
  from private.time_export_creation_operations as operation
  where operation.request_id = create_time_export.request_id;
  if found then
    if prior_operation.manager_membership_id <> manager_membership_id
      or prior_operation.payload_hash <> operation_hash then
      raise exception using errcode = '22023', message = 'export_request_id_reused';
    end if;
    if prior_operation.export_id is not null then
      select export.* into created_export from public.time_exports as export
      where export.id = prior_operation.export_id
        and export.organization_id = target_organization_id;
      return query select prior_operation.result_code, true, created_export.id,
        private.time_export_manifest(created_export);
    else
      return query select prior_operation.result_code, false, null::uuid, null::jsonb;
    end if;
    return;
  end if;

  perform entry.id from public.time_entries as entry
  where entry.organization_id = target_organization_id
    and entry.worksite_id = target_worksite_id
  order by entry.id for update;
  perform correction.id from public.correction_requests as correction
  where correction.organization_id = target_organization_id
    and correction.worksite_id = target_worksite_id
  order by correction.id for share;
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;

  -- One statement snapshot binds names, codes, facts, totals, and blockers, including
  -- memberships first created after employee-lock enumeration. The STABLE row helper
  -- sees this statement snapshot; no second factual read can create a mixed result.
  select pg_catalog.count(*), pg_catalog.count(distinct entry.membership_id),
    coalesce(pg_catalog.sum(
      extract(epoch from (entry.ended_at - entry.started_at)) * 1000000
    ), 0),
    coalesce(pg_catalog.sum(
      2048 + 6 * (
        pg_catalog.octet_length(coalesce(membership.employee_code, ''))
        + pg_catalog.octet_length(coalesce(profile.display_name, ''))
        + pg_catalog.octet_length(worksite.name)
      )
    ), 0),
    exists (
    select 1 from public.time_entries as entry
    where entry.organization_id = target_organization_id
      and entry.worksite_id = target_worksite_id
      and entry.ended_at is null and entry.started_at < utc_end
   ),
    exists (
    select 1 from public.correction_requests as request
    where request.organization_id = target_organization_id
      and request.worksite_id = target_worksite_id and request.status = 'pending'
      and (
        (request.target_time_entry_id is not null and exists (
          select 1 from public.time_entries as entry
          where entry.id = request.target_time_entry_id
            and entry.organization_id = target_organization_id
            and entry.worksite_id = target_worksite_id
            and entry.ended_at is not null
            and entry.ended_at > entry.started_at
            and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
            and entry.started_at >= utc_start and entry.started_at < utc_end
        ))
        or (request.proposed_started_at < utc_end and request.proposed_ended_at > utc_start)
      )
   ),
    case when pg_catalog.count(*) <= 10000 and coalesce(pg_catalog.sum(
      2048 + 6 * (
        pg_catalog.octet_length(coalesce(membership.employee_code, ''))
        + pg_catalog.octet_length(coalesce(profile.display_name, ''))
        + pg_catalog.octet_length(worksite.name)
      )
    ), 0) + 8192 <= 10485760
      then private.selected_time_export_records(
        target_organization_id, target_worksite_id, utc_start, utc_end
      ) else '[]'::jsonb end
  into records, employees, total_duration, estimated_artifact_bytes,
    has_open, has_pending, canonical_rows
  from public.time_entries as entry
  join public.memberships as membership on membership.id = entry.membership_id
    and membership.organization_id = target_organization_id
  left join public.profiles as profile on profile.user_id = membership.user_id
  join public.worksites as worksite on worksite.id = entry.worksite_id
    and worksite.organization_id = target_organization_id
  where entry.organization_id = target_organization_id
    and entry.worksite_id = target_worksite_id
    and entry.ended_at is not null
    and pg_catalog.isfinite(entry.started_at) and pg_catalog.isfinite(entry.ended_at)
    and entry.ended_at > entry.started_at
    and entry.started_at >= utc_start and entry.started_at < utc_end;
  outcome := case
    when has_open then 'open_entry'
    when has_pending then 'pending_correction'
    when records = 0 then 'no_records'
    when records > 10000 then 'row_limit'
    when estimated_artifact_bytes + 8192 > 10485760 then 'artifact_too_large'
    else 'created'
  end;
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Export kan niet worden bevestigd.';
  end if;
  operation_time := pg_catalog.clock_timestamp();
  if outcome <> 'created' then
    insert into private.time_export_creation_operations (
      request_id, organization_id, manager_membership_id, payload_hash,
      result_code, export_id, processed_at
    ) values (
      create_time_export.request_id, target_organization_id, manager_membership_id,
      operation_hash, outcome, null, operation_time
    );
    return query select outcome, false, null::uuid, null::jsonb;
    return;
  end if;

  created_export.id := pg_catalog.gen_random_uuid();
  created_export.organization_id := target_organization_id;
  created_export.worksite_id := target_worksite_id;
  created_export.schema_version := 'cloxa.time-export.v1';
  created_export.selection_rule := 'brussels-start-date.v1';
  created_export.timezone := 'Europe/Brussels';
  created_export.period_start_local := start_date;
  created_export.period_end_local := end_date;
  created_export.created_at := operation_time;
  created_export.record_count := records;
  created_export.employee_count := employees;
  created_export.total_duration_microseconds := total_duration;

  canonical_input := pg_catalog.jsonb_build_object(
    'manifest', pg_catalog.jsonb_build_object(
      'schema_version', created_export.schema_version,
      'export_id', created_export.id,
      'organization_id', created_export.organization_id,
      'worksite_id', created_export.worksite_id,
      'timezone', created_export.timezone,
      'period_start_local', created_export.period_start_local,
      'period_end_local', created_export.period_end_local,
      'created_at_utc', private.format_export_utc(created_export.created_at),
      'record_count', created_export.record_count,
      'employee_count', created_export.employee_count,
      'total_duration_microseconds', created_export.total_duration_microseconds::text,
      'selection_rule', created_export.selection_rule
    ),
    'records', canonical_rows
  );
  dataset_hash := pg_catalog.encode(pg_catalog.sha256(
    pg_catalog.convert_to(canonical_input::text, 'UTF8')
  ), 'hex');
  created_export.dataset_sha256 := dataset_hash;

  insert into public.time_exports select (created_export).*;
  insert into private.time_export_rows (
    export_id, organization_id, row_ordinal, source_time_entry_id,
    source_time_entry_version, employee_code, employee_display_name,
    worksite_id, worksite_name, started_at_utc, ended_at_utc,
    started_at_brussels, ended_at_brussels, duration_microseconds,
    factual_origin, last_correction_request_id
  )
  select created_export.id, target_organization_id,
    (record ->> 'row_ordinal')::integer,
    (record ->> 'source_time_entry_id')::uuid,
    (record ->> 'source_time_entry_version')::integer,
    record ->> 'employee_code', record ->> 'employee_display_name',
    (record ->> 'worksite_id')::uuid, record ->> 'worksite_name',
    record ->> 'started_at_utc', record ->> 'ended_at_utc',
    record ->> 'started_at_brussels', record ->> 'ended_at_brussels',
    (record ->> 'duration_microseconds')::numeric(30, 0),
    record ->> 'factual_origin',
    (record ->> 'last_correction_request_id')::uuid
  from pg_catalog.jsonb_array_elements(canonical_rows) as record;
  if (select pg_catalog.count(*) from private.time_export_rows as row
      where row.export_id = created_export.id) <> records then
    raise exception using errcode = '55000', message = 'export_snapshot_incomplete';
  end if;

  insert into public.audit_events (
    organization_id, actor_user_id, entity_type, entity_id, action,
    after_data, created_at
  ) values (
    target_organization_id, caller_id, 'time_export', created_export.id,
    'time_export.created',
    pg_catalog.jsonb_build_object(
      'schema_version', created_export.schema_version,
      'period_start_local', created_export.period_start_local,
      'period_end_local', created_export.period_end_local,
      'record_count', created_export.record_count,
      'employee_count', created_export.employee_count,
      'total_duration_microseconds', created_export.total_duration_microseconds::text,
      'dataset_sha256', created_export.dataset_sha256,
      'selection_rule', created_export.selection_rule
    ), operation_time
  );
  insert into private.time_export_creation_operations (
    request_id, organization_id, manager_membership_id, payload_hash,
    result_code, export_id, processed_at
  ) values (
    create_time_export.request_id, target_organization_id, manager_membership_id,
    operation_hash, 'created', created_export.id, operation_time
  );
  return query select 'created'::text, true, created_export.id,
    private.time_export_manifest(created_export);
end;
$$;

create function private.get_manager_time_exports()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := private.manager_review_organization();
  target_worksite_id uuid;
  worksite_count bigint;
  exports jsonb;
begin
  if target_organization_id is null then
    raise exception using errcode = '42501', message = 'Exportgeschiedenis kan niet worden geladen.';
  end if;
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '55000', message = 'Exportgeschiedenis kan niet worden geladen.';
  end if;
  select coalesce(pg_catalog.jsonb_agg(
    private.time_export_manifest(export) order by export.created_at desc, export.id desc
  ), '[]'::jsonb) into exports
  from (
    select metadata.* from public.time_exports as metadata
    where metadata.organization_id = target_organization_id
      and metadata.worksite_id = target_worksite_id
    order by metadata.created_at desc, metadata.id desc limit 20
  ) as export;
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Exportgeschiedenis kan niet worden geladen.';
  end if;
  return pg_catalog.jsonb_build_object('exports', exports);
end;
$$;

create function private.get_time_export_snapshot(target_export_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid := private.manager_review_organization();
  target_worksite_id uuid;
  worksite_count bigint;
  target_export public.time_exports%rowtype;
  records jsonb;
begin
  if target_export_id is null or target_organization_id is null then
    raise exception using errcode = '42501', message = 'Exportbestand is niet beschikbaar.';
  end if;
  select pg_catalog.count(*), (pg_catalog.array_agg(worksite.id order by worksite.id))[1]
  into worksite_count, target_worksite_id from public.worksites as worksite
  where worksite.organization_id = target_organization_id;
  if worksite_count <> 1 then
    raise exception using errcode = '42501', message = 'Exportbestand is niet beschikbaar.';
  end if;
  select export.* into target_export from public.time_exports as export
  where export.id = target_export_id
    and export.organization_id = target_organization_id
    and export.worksite_id = target_worksite_id;
  if not found then
    raise exception using errcode = '42501', message = 'Exportbestand is niet beschikbaar.';
  end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'row_ordinal', row.row_ordinal,
    'source_time_entry_id', row.source_time_entry_id,
    'source_time_entry_version', row.source_time_entry_version,
    'employee_code', row.employee_code,
    'employee_display_name', row.employee_display_name,
    'worksite_id', row.worksite_id,
    'worksite_name', row.worksite_name,
    'started_at_utc', row.started_at_utc,
    'ended_at_utc', row.ended_at_utc,
    'started_at_brussels', row.started_at_brussels,
    'ended_at_brussels', row.ended_at_brussels,
    'duration_microseconds', row.duration_microseconds::text,
    'factual_origin', row.factual_origin,
    'last_correction_request_id', row.last_correction_request_id
  ) order by row.row_ordinal), '[]'::jsonb) into records
  from private.time_export_rows as row
  where row.export_id = target_export.id
    and row.organization_id = target_organization_id;
  if pg_catalog.jsonb_array_length(records) <> target_export.record_count then
    raise exception using errcode = '55000', message = 'Exportbestand is niet beschikbaar.';
  end if;
  if private.manager_review_organization() is distinct from target_organization_id then
    raise exception using errcode = '42501', message = 'Exportbestand is niet beschikbaar.';
  end if;
  return pg_catalog.jsonb_build_object(
    'manifest', private.time_export_manifest(target_export),
    'records', records
  );
end;
$$;

create function public.preview_time_export(period_start_local text, period_end_local text)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.preview_time_export($1, $2);
$$;
create function public.create_time_export(
  request_id uuid, period_start_local text, period_end_local text, confirmed boolean
)
returns table (result_code text, did_create boolean, export_id uuid, manifest jsonb)
language sql security invoker set search_path = '' as $$
  select * from private.create_time_export($1, $2, $3, $4);
$$;
create function public.get_manager_time_exports()
returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_manager_time_exports();
$$;
create function public.get_time_export_snapshot(export_id uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select private.get_time_export_snapshot($1);
$$;

revoke all on table public.time_exports from public, anon, authenticated, service_role;
grant select (
  id, organization_id, worksite_id, schema_version, selection_rule, timezone,
  period_start_local, period_end_local, created_at, record_count,
  employee_count, total_duration_microseconds, dataset_sha256
) on public.time_exports to authenticated;
revoke all on table private.time_export_rows
  from public, anon, authenticated, service_role;
revoke all on table private.time_export_creation_operations
  from public, anon, authenticated, service_role;

revoke all on function private.reject_time_export_mutation()
  from public, anon, authenticated, service_role;
revoke all on function private.selected_time_export_records(uuid, uuid, timestamptz, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.export_local_date(text)
  from public, anon, authenticated, service_role;
revoke all on function private.format_export_utc(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.format_export_brussels(timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function private.time_export_manifest(public.time_exports)
  from public, anon, authenticated, service_role;
revoke all on function private.preview_time_export(text, text)
  from public, anon, authenticated, service_role;
revoke all on function private.create_time_export(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function private.get_manager_time_exports()
  from public, anon, authenticated, service_role;
revoke all on function private.get_time_export_snapshot(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.preview_time_export(text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.create_time_export(uuid, text, text, boolean)
  from public, anon, authenticated, service_role;
revoke all on function public.get_manager_time_exports()
  from public, anon, authenticated, service_role;
revoke all on function public.get_time_export_snapshot(uuid)
  from public, anon, authenticated, service_role;

grant execute on function private.preview_time_export(text, text) to authenticated;
grant execute on function private.create_time_export(uuid, text, text, boolean) to authenticated;
grant execute on function private.get_manager_time_exports() to authenticated;
grant execute on function private.get_time_export_snapshot(uuid) to authenticated;
grant execute on function public.preview_time_export(text, text) to authenticated;
grant execute on function public.create_time_export(uuid, text, text, boolean) to authenticated;
grant execute on function public.get_manager_time_exports() to authenticated;
grant execute on function public.get_time_export_snapshot(uuid) to authenticated;

alter table public.time_exports enable row level security;
alter table private.time_export_rows enable row level security;
alter table private.time_export_creation_operations enable row level security;
create policy time_exports_select_active_manager
on public.time_exports for select to authenticated
using (
  organization_id = (select private.manager_review_organization())
  and 1 = (select pg_catalog.count(*) from public.worksites as site
    where site.organization_id = time_exports.organization_id)
);

comment on function public.preview_time_export(text, text) is
  'Advisory manager preview for one inclusive Brussels period of at most 31 days.';
comment on function public.create_time_export(uuid, text, text, boolean) is
  'Idempotently confirm and atomically capture one exact factual export snapshot.';
comment on function public.get_manager_time_exports() is
  'Return at most 20 recent export manifests for the current authorized manager.';
comment on function public.get_time_export_snapshot(uuid) is
  'Reauthorize and return one exact tenant snapshot for server-controlled serialization.';
