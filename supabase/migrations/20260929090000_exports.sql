-- Signed, append-only export snapshots (docs/decisions/004-exports.md).
--
-- The web server builds the snapshot from RLS reads with @cloxa/domain (the
-- single source of truth for shift math), signs the exact bytes with a key the
-- caller never sees, and stores them here. The database cannot verify Ed25519,
-- so it re-checks everything it can on its own: the caller is privileged with
-- fresh MFA, the period and sites are within their reach, every row and shift
-- belongs to a visible employee and site, the row count matches, and it
-- computes the sha256 itself.
--
-- The content column is not granted to authenticated: the only way to read it
-- is rpc_record_export_download, which writes an audit row first.

-- Scope --------------------------------------------------------------------------------

-- p_site_ids null means the whole organization: owners and admins only. A
-- manager names managed sites explicitly. Fails closed on empty arrays and
-- null elements.
create function private.export_scope_ok(p_organization_id uuid, p_site_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    private.is_privileged(p_organization_id)
    and case
      when p_site_ids is null then
        (private.current_membership(p_organization_id)).role in ('owner', 'admin')
      when pg_catalog.cardinality(p_site_ids) = 0 then false
      when (private.current_membership(p_organization_id)).role in ('owner', 'admin') then
        not exists (
          select 1
          from pg_catalog.unnest(p_site_ids) as requested (site_id)
          where not exists (
            select 1
            from public.sites as site
            where site.organization_id = p_organization_id
              and site.id = requested.site_id
          )
        )
      else
        not exists (
          select 1
          from pg_catalog.unnest(p_site_ids) as requested (site_id)
          where not exists (
            select 1
            from public.site_assignments as managed
            where managed.organization_id = p_organization_id
              and managed.membership_id = (private.current_membership(p_organization_id)).id
              and managed.site_id = requested.site_id
          )
        )
    end,
    false
  );
$$;

comment on function private.export_scope_ok(uuid, uuid[]) is
  'Privileged (fresh MFA) and the sites are reachable: null (whole org) for owner/admin, managed sites for a manager.';

-- Table ----------------------------------------------------------------------------------

create table public.exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  -- Null: every site of the organization (owner/admin only). Sorted, distinct.
  site_ids uuid[],
  -- Europe/Brussels calendar days, inclusive.
  period_from date not null,
  period_to date not null,
  format_version text not null,
  created_by uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  row_count integer not null,
  content_sha256 bytea not null,
  -- Ed25519 over the exact content bytes, produced by the web server.
  signature bytea not null,
  signing_key_id text not null,
  -- The canonical JSON snapshot (UTF-8), byte for byte what was signed.
  content bytea not null,
  constraint exports_organization_id_id_key unique (organization_id, id),
  constraint exports_site_ids_check check (
    site_ids is null
    or (
      pg_catalog.cardinality(site_ids) between 1 and 500
      and pg_catalog.array_position(site_ids, null) is null
    )
  ),
  constraint exports_period_check
    check (period_to >= period_from and period_to - period_from <= 61),
  constraint exports_format_version_check check (format_version = 'cloxa.export.v1'),
  constraint exports_row_count_check check (row_count >= 0),
  constraint exports_content_sha256_check
    check (content_sha256 = extensions.digest(content, 'sha256')),
  constraint exports_signature_check check (octet_length(signature) = 64),
  constraint exports_signing_key_id_check check (signing_key_id ~ '^[A-Za-z0-9._-]{1,64}$'),
  constraint exports_content_check check (octet_length(content) <= 10485760)
);

comment on table public.exports is
  'Append-only, server-signed export snapshots. Content is only readable through rpc_record_export_download (audited).';

create index exports_organization_created_at_idx
  on public.exports (organization_id, created_at desc);

create trigger exports_reject_update_delete
before update or delete on public.exports
for each row execute function private.reject_mutation();

-- TRUNCATE bypasses row triggers and RLS.
create trigger exports_reject_truncate
before truncate on public.exports
for each statement execute function private.reject_mutation();

-- rpc_create_export ---------------------------------------------------------------------

create function private.create_export(
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

  -- Sorted and distinct, so the stored scope and the signed content agree on
  -- one spelling.
  if p_site_ids is not null and p_site_ids is distinct from (
    select pg_catalog.array_agg(distinct requested.site_id order by requested.site_id)
    from pg_catalog.unnest(p_site_ids) as requested (site_id)
  ) then
    raise exception using errcode = '22023', message = 'invalid_sites';
  end if;

  if not private.export_scope_ok(p_org, p_site_ids) then
    raise exception using errcode = '42501', message = 'site_not_visible';
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

  -- The header must describe exactly this request, for this caller.
  if pg_catalog.jsonb_typeof(v_content) is distinct from 'object'
    or (v_content ->> 'format_version') is distinct from 'cloxa.export.v1'
    or (v_content ->> 'organization_id') is distinct from p_org::text
    or (v_content ->> 'created_by') is distinct from (select auth.uid())::text
    or (v_content #>> '{period,from}') is distinct from v_from
    or (v_content #>> '{period,to}') is distinct from v_to
    or (v_content -> 'site_ids') is distinct from coalesce(pg_catalog.to_jsonb(p_site_ids), 'null'::jsonb)
    or pg_catalog.jsonb_typeof(v_content -> 'rows') is distinct from 'array'
  then
    raise exception using errcode = '22023', message = 'invalid_content';
  end if;

  if p_row_count is null or pg_catalog.jsonb_array_length(v_content -> 'rows') <> p_row_count then
    raise exception using errcode = '22023', message = 'row_count_mismatch';
  end if;

  -- Row shape. CASE fixes the evaluation order, so the checks after a
  -- failed one never see a malformed value.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(v_content -> 'rows') as row_entry (value)
    where case
      when pg_catalog.jsonb_typeof(row_entry.value) <> 'object' then true
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

-- rpc_record_export_download --------------------------------------------------------------

-- The only way to read export content: audit first, then return the bytes.
-- Unknown, foreign and out-of-scope exports look the same.
create function private.record_export_download(p_export_id uuid, p_format text)
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

  if not found or not private.export_scope_ok(v_export.organization_id, v_export.site_ids) then
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

-- rpc_record_self_export ----------------------------------------------------------------

-- An employee downloads their own hours (built on the fly, not stored). Self
-- only: the employee row must be the caller's own, through an active
-- membership. No MFA needed, like every self read.
create function private.record_self_export(
  p_employee_id uuid,
  p_period_from date,
  p_period_to date
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_organization_id uuid;
begin
  select employee.organization_id
  into v_organization_id
  from public.employees as employee
  join public.memberships as membership
    on membership.organization_id = employee.organization_id
   and membership.user_id = employee.user_id
  where employee.id = p_employee_id
    and employee.user_id = (select auth.uid())
    and membership.status = 'active';

  if not found then
    raise exception using errcode = '42501', message = 'not_authorized';
  end if;

  if p_period_from is null
    or p_period_to is null
    or p_period_to < p_period_from
    or p_period_to - p_period_from > 61
  then
    raise exception using errcode = '22023', message = 'invalid_period';
  end if;

  perform private.write_audit(
    v_organization_id,
    'export.self_downloaded',
    'employee',
    p_employee_id,
    pg_catalog.jsonb_build_object(
      'period_from', p_period_from,
      'period_to', p_period_to,
      'format', 'csv'
    )
  );
end;
$$;

-- Public wrappers -------------------------------------------------------------------------

create function public.rpc_create_export(
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
language sql
volatile
security definer
set search_path = ''
as $$
  select private.create_export(
    p_org, p_period_from, p_period_to, p_site_ids, p_row_count, p_content, p_signature, p_signing_key_id
  );
$$;

comment on function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text) is
  'Privileged (fresh MFA): store a server-signed export snapshot (at most 62 days, 10 MiB) within the caller''s site scope.';

create function public.rpc_record_export_download(p_export_id uuid, p_format text)
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
  select * from private.record_export_download(p_export_id, p_format);
$$;

comment on function public.rpc_record_export_download(uuid, text) is
  'Privileged (fresh MFA), in scope: audit a download (csv/json), then return the stored export.';

create function public.rpc_record_self_export(
  p_employee_id uuid,
  p_period_from date,
  p_period_to date
)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  select private.record_self_export(p_employee_id, p_period_from, p_period_to);
$$;

comment on function public.rpc_record_self_export(uuid, date, date) is
  'Employee self only: audit a download of their own hours (at most 62 days).';

-- Access ------------------------------------------------------------------------------------

alter table public.exports enable row level security;

revoke all on table public.exports from public, anon, authenticated, service_role;
-- Every column except content: content only leaves through the audited RPC.
grant select (
  id,
  organization_id,
  site_ids,
  period_from,
  period_to,
  format_version,
  created_by,
  created_at,
  row_count,
  content_sha256,
  signature,
  signing_key_id
) on table public.exports to authenticated;
grant select on table public.exports to service_role;

create policy exports_select_in_scope
on public.exports
for select
to authenticated
using (private.export_scope_ok(organization_id, site_ids));

revoke all on function private.export_scope_ok(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function private.create_export(uuid, date, date, uuid[], integer, text, bytea, text)
  from public, anon, authenticated, service_role;
revoke all on function private.record_export_download(uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.record_self_export(uuid, date, date) from public, anon, authenticated, service_role;
revoke all on function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text)
  from public, anon, authenticated, service_role;
revoke all on function public.rpc_record_export_download(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.rpc_record_self_export(uuid, date, date) from public, anon, authenticated, service_role;

-- The RLS policy calls export_scope_ok as the requesting role.
grant execute on function private.export_scope_ok(uuid, uuid[]) to authenticated;
grant execute on function public.rpc_create_export(uuid, date, date, uuid[], integer, text, bytea, text)
  to authenticated;
grant execute on function public.rpc_record_export_download(uuid, text) to authenticated;
grant execute on function public.rpc_record_self_export(uuid, date, date) to authenticated;
