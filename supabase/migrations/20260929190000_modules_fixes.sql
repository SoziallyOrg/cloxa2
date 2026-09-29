-- Modules fixes after the security review (ADR 008).
--
-- 1. rpc_set_employee_module_data audits the sha256 of the old and new data
--    (jsonb text), and for interim the old and new agency name (a company,
--    not a person).
-- 2. Module data only for a statute the module applies to
--    (private.module_statutes mirrors @cloxa/modules; a unit test compares
--    the two), and an agency export only holds interim-statute workers.
-- 3. Control characters are refused in agency names and in
--    exports.interim_agency.

-- 1 and 2. Module data ---------------------------------------------------------------------

-- The statutes each module applies to. Must match `statutes` in
-- packages/modules (registry.test.ts reads this function).
create function private.module_statutes(p_module text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select case p_module
    when 'student' then array['student']
    when 'flexi' then array['flexi']
    when 'interim' then array['interim']
    when 'overuren' then array['bediende', 'arbeider', 'other']
    when 'telework' then array['bediende', 'arbeider', 'student', 'flexi', 'interim', 'other']
  end;
$$;

comment on function private.module_statutes(text) is
  'Statutes a module applies to; mirrors @cloxa/modules.';

-- Hex sha256 of a jsonb value's text (jsonb text is canonical: sorted keys).
create function private.jsonb_sha256(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null then null
    else pg_catalog.encode(extensions.digest(pg_catalog.convert_to(p_value::text, 'UTF8'), 'sha256'), 'hex')
  end;
$$;

create or replace function private.set_employee_module_data(p_employee_id uuid, p_module text, p_data jsonb)
returns public.employee_module_data
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_employee public.employees;
  v_old jsonb;
  v_row public.employee_module_data;
  v_metadata jsonb;
begin
  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = p_employee_id;

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.require_privileged(v_employee.organization_id);
  if not private.can_see_employee(v_employee.id) then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if not private.is_module_id(p_module) then
    raise exception using errcode = '22023', message = 'invalid_module';
  end if;
  if not private.module_enabled(v_employee.organization_id, p_module) then
    raise exception using errcode = '22023', message = 'module_disabled';
  end if;
  if not (v_employee.statute = any (private.module_statutes(p_module))) then
    raise exception using errcode = '22023', message = 'module_not_applicable';
  end if;
  if v_employee.anonymised_at is not null then
    raise exception using errcode = '22023', message = 'employee_anonymised';
  end if;
  if not private.is_module_payload(p_data) then
    raise exception using errcode = '22023', message = 'invalid_data';
  end if;
  -- Company names and references end up in exports and CSV cells.
  if p_module = 'interim' and (
    coalesce(p_data ->> 'agency_name', '') ~ '[\x01-\x1f\x7f]'
    or coalesce(p_data ->> 'agency_reference', '') ~ '[\x01-\x1f\x7f]'
  ) then
    raise exception using errcode = '22023', message = 'invalid_data';
  end if;

  -- Under the row lock, so the old value in the log is the one replaced.
  select module_data.data
  into v_old
  from public.employee_module_data as module_data
  where module_data.organization_id = v_employee.organization_id
    and module_data.employee_id = v_employee.id
    and module_data.module = p_module
  for update;

  insert into public.employee_module_data as module_data (organization_id, employee_id, module, data, updated_by)
  values (v_employee.organization_id, v_employee.id, p_module, p_data, (select auth.uid()))
  on conflict (organization_id, employee_id, module) do update
  set data = excluded.data,
      updated_by = excluded.updated_by,
      updated_at = pg_catalog.clock_timestamp()
  returning * into v_row;

  v_metadata := pg_catalog.jsonb_build_object(
    'employee_id', v_employee.id,
    'module', p_module,
    'field_keys', coalesce(
      (select pg_catalog.jsonb_agg(data_key.name order by data_key.name)
       from pg_catalog.jsonb_object_keys(p_data) as data_key (name)),
      '[]'::jsonb
    ),
    'old_sha256', private.jsonb_sha256(v_old),
    'new_sha256', private.jsonb_sha256(p_data)
  );
  if p_module = 'interim' then
    v_metadata := v_metadata || pg_catalog.jsonb_build_object(
      'agency_name_old', v_old ->> 'agency_name',
      'agency_name_new', p_data ->> 'agency_name'
    );
  end if;

  perform private.write_audit(
    v_employee.organization_id,
    'employee.module_data_updated',
    'employee',
    v_employee.id,
    v_metadata
  );

  return v_row;
end;
$$;

-- 2 and 3. Exports -------------------------------------------------------------------------

alter table public.exports
  add constraint exports_interim_agency_control_check
    check (interim_agency is null or interim_agency !~ '[\x01-\x1f\x7f]');

create or replace function private.create_export(
  p_org uuid,
  p_period_from date,
  p_period_to date,
  p_site_ids uuid[],
  p_row_count integer,
  p_content text,
  p_signature bytea,
  p_signing_key_id text,
  p_interim_agency text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_top_keys constant text[] := array[
    'format_version', 'organization_id', 'created_by', 'generated_at', 'period', 'site_ids', 'rows',
    'modules', 'interim_agency'
  ];
  v_period_keys constant text[] := array['from', 'to', 'timezone'];
  v_row_keys constant text[] := array[
    'day', 'employee_id', 'employee_code', 'employee_name', 'shifts',
    'planned_ms', 'worked_net_ms', 'deviation_ms', 'edited', 'modules'
  ];
  v_shift_keys constant text[] := array[
    'site_id', 'site_name', 'start_utc', 'end_utc', 'start_local', 'end_local',
    'break_ms', 'gross_ms', 'net_ms', 'edited', 'open', 'overnight'
  ];
  v_content jsonb;
  v_modules jsonb;
  v_from text;
  v_to text;
  v_id uuid;
begin
  perform private.require_privileged(p_org);

  if p_period_from is null
    or p_period_to is null
    or p_period_to < p_period_from
    or p_period_to - p_period_from > 61
  then
    raise exception using errcode = '22023', message = 'invalid_period';
  end if;

  -- Sorted, distinct and without nulls, so the stored scope and the signed
  -- content agree on one spelling.
  if p_site_ids is not null and (
    pg_catalog.array_position(p_site_ids, null) is not null
    or p_site_ids is distinct from (
      select pg_catalog.array_agg(distinct requested.site_id order by requested.site_id)
      from pg_catalog.unnest(p_site_ids) as requested (site_id)
    )
  ) then
    raise exception using errcode = '22023', message = 'invalid_sites';
  end if;

  if p_interim_agency is not null
    and (
      btrim(p_interim_agency) <> p_interim_agency
      or char_length(p_interim_agency) not between 1 and 200
      or p_interim_agency ~ '[\x01-\x1f\x7f]'
    )
  then
    raise exception using errcode = '22023', message = 'invalid_interim_agency';
  end if;

  if not private.export_scope_ok(p_org, p_site_ids) then
    raise exception using errcode = '42501', message = 'site_not_visible';
  end if;

  -- Serialize creations per organization (the audit chain lock, taken again
  -- by write_audit below), so two parallel requests cannot both pass the count.
  perform pg_catalog.pg_advisory_xact_lock(1001, pg_catalog.hashtext(p_org::text));

  if (
      select pg_catalog.count(*)
      from public.audit_log as log
      where log.action = 'export.created'
        and log.actor_user_id = (select auth.uid())
        and log.created_at > pg_catalog.now() - interval '1 hour'
    ) >= 20
    or (
      select pg_catalog.count(*)
      from public.audit_log as log
      where log.organization_id = p_org
        and log.action = 'export.created'
        and log.created_at > pg_catalog.now() - interval '1 day'
    ) >= 100
  then
    raise exception using errcode = '54000', message = 'export_rate_limited';
  end if;

  -- Measured before parsing, so an oversized payload costs no JSON work.
  if p_content is null or octet_length(p_content) > 10485760 then
    raise exception using errcode = '22023', message = 'content_too_large';
  end if;

  if p_signature is null or octet_length(p_signature) <> 64 then
    raise exception using errcode = '22023', message = 'invalid_signature';
  end if;

  if p_signing_key_id is null or p_signing_key_id !~ '^[A-Za-z0-9._-]{1,64}$' then
    raise exception using errcode = '22023', message = 'invalid_signing_key_id';
  end if;

  begin
    v_content := p_content::jsonb;
  exception
    when others then
      raise exception using errcode = '22023', message = 'invalid_content';
  end;

  v_from := pg_catalog.to_char(p_period_from, 'YYYY-MM-DD');
  v_to := pg_catalog.to_char(p_period_to, 'YYYY-MM-DD');

  -- The header must describe exactly this request, for this caller, and
  -- carry nothing else.
  if (case
    when pg_catalog.jsonb_typeof(v_content) is distinct from 'object' then true
    when not private.jsonb_keys_within(v_content, v_top_keys) then true
    when pg_catalog.jsonb_typeof(v_content -> 'period') is distinct from 'object' then true
    when not private.jsonb_keys_within(v_content -> 'period', v_period_keys) then true
    else (v_content ->> 'format_version') is distinct from 'cloxa.export.v1'
      or (v_content ->> 'organization_id') is distinct from p_org::text
      or (v_content ->> 'created_by') is distinct from (select auth.uid())::text
      or (v_content #>> '{period,from}') is distinct from v_from
      or (v_content #>> '{period,to}') is distinct from v_to
      or (v_content -> 'site_ids') is distinct from coalesce(pg_catalog.to_jsonb(p_site_ids), 'null'::jsonb)
      or pg_catalog.jsonb_typeof(v_content -> 'rows') is distinct from 'array'
      or (v_content -> 'interim_agency') is distinct from pg_catalog.to_jsonb(p_interim_agency)
  end) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  -- Modules: absent, or a sorted list of distinct known modules. An agency
  -- export needs the interim module.
  v_modules := v_content -> 'modules';
  if (case
    when v_modules is null then p_interim_agency is not null
    when pg_catalog.jsonb_typeof(v_modules) <> 'array' then true
    when pg_catalog.jsonb_array_length(v_modules) = 0 then true
    when exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_modules) as module_entry (value)
      where pg_catalog.jsonb_typeof(module_entry.value) <> 'string'
        or not private.is_module_id(module_entry.value #>> '{}')
    ) then true
    else v_modules is distinct from (
        select pg_catalog.jsonb_agg(distinct module_entry.value order by module_entry.value)
        from pg_catalog.jsonb_array_elements(v_modules) as module_entry (value)
      )
      or (p_interim_agency is not null and not v_modules @> '["interim"]'::jsonb)
  end) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  if p_row_count is null or pg_catalog.jsonb_array_length(v_content -> 'rows') <> p_row_count then
    raise exception using errcode = '22023', message = 'row_count_mismatch';
  end if;

  -- Row and shift shape. CASE fixes the evaluation order, so the checks after
  -- a failed one never see a malformed value.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where case
      when pg_catalog.jsonb_typeof(row_entry.value) <> 'object' then true
      when not private.jsonb_keys_within(row_entry.value, v_row_keys) then true
      when pg_catalog.jsonb_typeof(row_entry.value -> 'employee_id') is distinct from 'string' then true
      when (row_entry.value ->> 'employee_id') !~ v_uuid then true
      when pg_catalog.jsonb_typeof(row_entry.value -> 'day') is distinct from 'string' then true
      when (row_entry.value ->> 'day') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then true
      when (row_entry.value ->> 'day') < v_from or (row_entry.value ->> 'day') > v_to then true
      when pg_catalog.jsonb_typeof(row_entry.value -> 'shifts') is distinct from 'array' then true
      -- Rows carry "modules" exactly when the header lists them.
      when (row_entry.value ? 'modules') is distinct from (v_modules is not null) then true
      when v_modules is not null
        and not private.is_export_modules_value(row_entry.value -> 'modules', v_modules)
        then true
      else exists (
        select 1
        from pg_catalog.jsonb_array_elements(row_entry.value -> 'shifts') as shift_entry (value)
        where case
          when pg_catalog.jsonb_typeof(shift_entry.value) <> 'object' then true
          when not private.jsonb_keys_within(shift_entry.value, v_shift_keys) then true
          when pg_catalog.jsonb_typeof(shift_entry.value -> 'site_id') is distinct from 'string' then true
          else (shift_entry.value ->> 'site_id') !~ v_uuid
        end
      )
    end
  ) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  -- One row per employee per day.
  if (
    select pg_catalog.count(*) <> pg_catalog.count(distinct (row_entry.value ->> 'employee_id', row_entry.value ->> 'day'))
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
  ) then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  -- Every row is a visible employee of this organization, and every shift is
  -- at a site inside the export scope. Shapes were checked above, so the
  -- casts are safe.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where not exists (
        select 1
        from public.employees as employee
        where employee.id = (row_entry.value ->> 'employee_id')::uuid
          and employee.organization_id = p_org
      )
      or not private.can_see_employee((row_entry.value ->> 'employee_id')::uuid)
      or exists (
        select 1
        from pg_catalog.jsonb_array_elements(row_entry.value -> 'shifts') as shift_entry (value)
        where case
          when p_site_ids is null then not exists (
            select 1
            from public.sites as site
            where site.organization_id = p_org
              and site.id = (shift_entry.value ->> 'site_id')::uuid
          )
          else not ((shift_entry.value ->> 'site_id')::uuid = any (p_site_ids))
        end
      )
  ) then
    raise exception using errcode = '42501', message = 'row_not_visible';
  end if;

  -- An agency export holds only that agency's workers: interim statute,
  -- and that agency in their interim data.
  if p_interim_agency is not null and exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where not exists (
      select 1
      from public.employee_module_data as module_data
      join public.employees as employee
        on employee.organization_id = module_data.organization_id
       and employee.id = module_data.employee_id
      where module_data.organization_id = p_org
        and module_data.employee_id = (row_entry.value ->> 'employee_id')::uuid
        and module_data.module = 'interim'
        and employee.statute = 'interim'
        and (module_data.data ->> 'agency_name') = p_interim_agency
    )
  ) then
    raise exception using errcode = '42501', message = 'row_not_visible';
  end if;

  insert into public.exports (
    organization_id,
    site_ids,
    period_from,
    period_to,
    format_version,
    created_by,
    row_count,
    content_sha256,
    signature,
    signing_key_id,
    content,
    interim_agency
  )
  values (
    p_org,
    p_site_ids,
    p_period_from,
    p_period_to,
    'cloxa.export.v1',
    (select auth.uid()),
    p_row_count,
    extensions.digest(pg_catalog.convert_to(p_content, 'UTF8'), 'sha256'),
    p_signature,
    p_signing_key_id,
    pg_catalog.convert_to(p_content, 'UTF8'),
    p_interim_agency
  )
  returning id into v_id;

  perform private.write_audit(
    p_org,
    'export.created',
    'export',
    v_id,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'period_from', p_period_from,
      'period_to', p_period_to,
      'site_count', pg_catalog.cardinality(p_site_ids),
      'row_count', p_row_count,
      'signing_key_id', p_signing_key_id,
      'modules', v_modules,
      'agency_filter', case when p_interim_agency is not null then true end
    ))
  );

  return v_id;
end;
$$;

revoke all on function private.module_statutes(text) from public, anon, authenticated, service_role;
revoke all on function private.jsonb_sha256(jsonb) from public, anon, authenticated, service_role;
