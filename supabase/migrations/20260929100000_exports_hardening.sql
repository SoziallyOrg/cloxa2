-- Exports hardening (security review of 20260929090000_exports.sql):
--   * strict content shape: unknown keys are refused at every level;
--   * creation limits: 20 per user per hour, 100 per organization per day;
--   * downloads are bound to the organization the caller has selected;
--   * integrity failures seen by the web server are audited;
--   * retention: private.purge_exports, callable by no API role.

-- Creation limits ---------------------------------------------------------------------------

-- The per-user count reads the audit trail by actor; the per-org count uses
-- the existing (organization_id, created_at) index.
create index audit_log_export_created_actor_idx
  on public.audit_log (actor_user_id, created_at)
  where action = 'export.created';

-- True when every key of p_object is in p_allowed.
create function private.jsonb_keys_within(p_object jsonb, p_allowed text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1
    from pg_catalog.jsonb_object_keys(p_object) as object_key (name)
    where not (object_key.name = any (p_allowed))
  );
$$;

create or replace function private.create_export(
  p_org uuid,
  p_period_from date,
  p_period_to date,
  p_site_ids uuid[],
  p_row_count integer,
  p_content text,
  p_signature bytea,
  p_signing_key_id text
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
    'format_version', 'organization_id', 'created_by', 'generated_at', 'period', 'site_ids', 'rows'
  ];
  v_period_keys constant text[] := array['from', 'to', 'timezone'];
  v_row_keys constant text[] := array[
    'day', 'employee_id', 'employee_code', 'employee_name', 'shifts',
    'planned_ms', 'worked_net_ms', 'deviation_ms', 'edited'
  ];
  v_shift_keys constant text[] := array[
    'site_id', 'site_name', 'start_utc', 'end_utc', 'start_local', 'end_local',
    'break_ms', 'gross_ms', 'net_ms', 'edited', 'open', 'overnight'
  ];
  v_content jsonb;
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
    content
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
    pg_catalog.convert_to(p_content, 'UTF8')
  )
  returning id into v_id;

  perform private.write_audit(
    p_org,
    'export.created',
    'export',
    v_id,
    pg_catalog.jsonb_build_object(
      'period_from', p_period_from,
      'period_to', p_period_to,
      'site_count', pg_catalog.cardinality(p_site_ids),
      'row_count', p_row_count,
      'signing_key_id', p_signing_key_id
    )
  );

  return v_id;
end;
$$;

-- Downloads, bound to the selected organization -----------------------------------------------

drop function public.rpc_record_export_download(uuid, text);
drop function private.record_export_download(uuid, text);

-- The export must belong to p_org (the organization the caller has selected
-- in the app) and be in the caller's scope there. Unknown, foreign and
-- out-of-scope exports look the same.
create function private.record_export_download(p_org uuid, p_export_id uuid, p_format text)
returns table (
  id uuid,
  organization_id uuid,
  site_ids uuid[],
  period_from date,
  period_to date,
  format_version text,
  created_by uuid,
  created_at timestamptz,
  row_count integer,
  content text,
  content_sha256_hex text,
  signature_hex text,
  signing_key_id text
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_export public.exports;
begin
  if p_format is null or p_format not in ('csv', 'json') then
    raise exception using errcode = '22023', message = 'invalid_format';
  end if;

  select stored.*
  into v_export
  from public.exports as stored
  where stored.id = p_export_id;

  if not found
    or v_export.organization_id is distinct from p_org
    or not private.export_scope_ok(v_export.organization_id, v_export.site_ids)
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.write_audit(
    v_export.organization_id,
    'export.downloaded',
    'export',
    v_export.id,
    pg_catalog.jsonb_build_object('format', p_format)
  );

  return query
  select
    v_export.id,
    v_export.organization_id,
    v_export.site_ids,
    v_export.period_from,
    v_export.period_to,
    v_export.format_version,
    v_export.created_by,
    v_export.created_at,
    v_export.row_count,
    pg_catalog.convert_from(v_export.content, 'UTF8'),
    pg_catalog.encode(v_export.content_sha256, 'hex'),
    pg_catalog.encode(v_export.signature, 'hex'),
    v_export.signing_key_id;
end;
$$;

create function public.rpc_record_export_download(p_org uuid, p_export_id uuid, p_format text)
returns table (
  id uuid,
  organization_id uuid,
  site_ids uuid[],
  period_from date,
  period_to date,
  format_version text,
  created_by uuid,
  created_at timestamptz,
  row_count integer,
  content text,
  content_sha256_hex text,
  signature_hex text,
  signing_key_id text
)
language sql
volatile
security definer
set search_path = ''
as $$
  select * from private.record_export_download(p_org, p_export_id, p_format);
$$;

comment on function public.rpc_record_export_download(uuid, uuid, text) is
  'Privileged (fresh MFA), in scope, export of p_org: audit a download (csv/json), then return the stored export.';

-- Integrity failures --------------------------------------------------------------------------

-- The web server found a stored export whose hash or signature does not
-- verify. Same access rule as a download; the row makes the failure visible
-- in the audit trail.
create function private.record_export_integrity_failure(p_org uuid, p_export_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_export public.exports;
begin
  if p_reason is null or p_reason not in ('hash', 'signature') then
    raise exception using errcode = '22023', message = 'invalid_reason';
  end if;

  select stored.*
  into v_export
  from public.exports as stored
  where stored.id = p_export_id;

  if not found
    or v_export.organization_id is distinct from p_org
    or not private.export_scope_ok(v_export.organization_id, v_export.site_ids)
  then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  perform private.write_audit(
    v_export.organization_id,
    'export.integrity_failed',
    'export',
    v_export.id,
    pg_catalog.jsonb_build_object('reason', p_reason, 'signing_key_id', v_export.signing_key_id)
  );
end;
$$;

create function public.rpc_record_export_integrity_failure(p_org uuid, p_export_id uuid, p_reason text)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.record_export_integrity_failure(p_org, p_export_id, p_reason);
$$;

comment on function public.rpc_record_export_integrity_failure(uuid, uuid, text) is
  'Privileged (fresh MFA), in scope: audit that a stored export failed its hash or signature check.';

-- Retention -----------------------------------------------------------------------------------

-- Deletes stay refused, except inside private.purge_exports, which sets this
-- transaction-local flag. Only roles that already hold DELETE on the table
-- (the owner) could reach the trigger at all: API roles have no DELETE grant.
create function private.exports_reject_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
    and coalesce(pg_catalog.current_setting('cloxa.purging_exports', true), '') = 'on'
  then
    return old;
  end if;

  raise exception using
    errcode = '55000',
    message = pg_catalog.format('%s is append-only', tg_table_name);
end;
$$;

drop trigger exports_reject_update_delete on public.exports;

create trigger exports_reject_update_delete
before update or delete on public.exports
for each row execute function private.exports_reject_mutation();

-- Hard-deletes exports whose period ended before p_before, but never within
-- an organization's retention (settings.retention_years, at least 5 years):
-- an export lives as long as the records it covers. One audit row per
-- organization touched. For a scheduled job (TODO), not for any API role.
create function private.purge_exports(p_before date)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org record;
  v_count integer;
  v_total integer := 0;
begin
  if p_before is null then
    raise exception using errcode = '22023', message = 'invalid_before';
  end if;

  perform pg_catalog.set_config('cloxa.purging_exports', 'on', true);

  for v_org in
    select
      organization.id,
      least(
        p_before,
        (current_date
          - pg_catalog.make_interval(years => (organization.settings ->> 'retention_years')::numeric::integer))::date
      ) as cutoff
    from public.organizations as organization
    where exists (select 1 from public.exports as stored where stored.organization_id = organization.id)
  loop
    delete from public.exports as stored
    where stored.organization_id = v_org.id
      and stored.period_to < v_org.cutoff;

    get diagnostics v_count = row_count;

    if v_count > 0 then
      perform private.write_audit(
        v_org.id,
        'export.purged',
        'organization',
        v_org.id,
        pg_catalog.jsonb_build_object('before', v_org.cutoff, 'count', v_count)
      );
      v_total := v_total + v_count;
    end if;
  end loop;

  perform pg_catalog.set_config('cloxa.purging_exports', '', true);

  return v_total;
end;
$$;

comment on function private.purge_exports(date) is
  'Retention purge: deletes exports whose period ended before p_before and outside the org retention. Granted to no role.';

-- Access ------------------------------------------------------------------------------------

revoke all on function private.jsonb_keys_within(jsonb, text[]) from public, anon, authenticated, service_role;
revoke all on function private.record_export_download(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_record_export_download(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.record_export_integrity_failure(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_record_export_integrity_failure(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function private.exports_reject_mutation() from public, anon, authenticated, service_role;
revoke all on function private.purge_exports(date) from public, anon, authenticated, service_role;

grant execute on function public.rpc_record_export_download(uuid, uuid, text) to authenticated;
grant execute on function public.rpc_record_export_integrity_failure(uuid, uuid, text) to authenticated;
