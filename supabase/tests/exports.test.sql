begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

-- Sign in as p_sub for the rest of the transaction. Without p_mfa_age: aal1
-- (email code only). With p_mfa_age: aal2 with a TOTP verified that long ago.
create function pg_temp.login(p_sub text, p_mfa_age interval default null)
returns void
language plpgsql
as $$
declare
  v_now bigint := extract(epoch from now())::bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_sub,
    'role', 'authenticated',
    'aal', case when p_mfa_age is null then 'aal1' else 'aal2' end,
    'amr', case
      when p_mfa_age is null then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', v_now))
      else jsonb_build_array(
        jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now() - p_mfa_age)::bigint),
        jsonb_build_object('method', 'otp', 'timestamp', v_now))
    end
  )::text, true);
end;
$$;

-- A minimal export snapshot as the web server would send it (the database
-- only checks the header, row shape and scope; the web layer owns the math).
create function pg_temp.content(
  p_org text,
  p_created_by text,
  p_from text,
  p_to text,
  p_site_ids jsonb,
  p_rows jsonb
)
returns text
language sql
as $$
  select jsonb_build_object(
    'format_version', 'cloxa.export.v1',
    'organization_id', p_org,
    'created_by', p_created_by,
    'period', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', 'Europe/Brussels'),
    'site_ids', p_site_ids,
    'rows', p_rows
  )::text;
$$;

create function pg_temp.row(p_employee text, p_day text, p_site text)
returns jsonb
language sql
as $$
  select jsonb_build_object(
    'employee_id', p_employee,
    'day', p_day,
    'shifts', case when p_site is null then '[]'::jsonb
      else jsonb_build_array(jsonb_build_object('site_id', p_site)) end
  );
$$;

select plan(43);

-- Fixtures (rolled back). Org A: owner u1, manager u2 (manages A1), employee
-- u3 (A1), employee u4 (A2). Org B: owner u5 (B1).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000050' || n)::uuid, 'export-u' || n || '@example.test'
from generate_series(1, 5) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000050a', 'Export Org A'),
  ('10000000-0000-4000-8000-00000000050b', 'Export Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000005a1', '10000000-0000-4000-8000-00000000050a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000005a2', '10000000-0000-4000-8000-00000000050a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000005b1', '10000000-0000-4000-8000-00000000050b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000050' || n)::uuid,
  case when n = 5 then '10000000-0000-4000-8000-00000000050b' else '10000000-0000-4000-8000-00000000050a' end::uuid,
  ('00000000-0000-4000-8000-00000000050' || n)::uuid,
  (array['owner', 'manager', 'employee', 'employee', 'owner'])[n],
  'active'
from generate_series(1, 5) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000050' || n)::uuid,
  case when n = 5 then '10000000-0000-4000-8000-00000000050b' else '10000000-0000-4000-8000-00000000050a' end::uuid,
  ('00000000-0000-4000-8000-00000000050' || n)::uuid,
  'Export employee ' || n
from generate_series(1, 5) as n;

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000503', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a2', '40000000-0000-4000-8000-000000000504', null),
  ('10000000-0000-4000-8000-00000000050b', '20000000-0000-4000-8000-0000000005b1', '40000000-0000-4000-8000-000000000505', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', null, '30000000-0000-4000-8000-000000000502');

create temporary table ids (label text primary key, id uuid) on commit drop;
grant select, insert on ids to authenticated;

-- Structure --------------------------------------------------------------------------------

select columns_are(
  'public', 'exports',
  array['id', 'organization_id', 'site_ids', 'period_from', 'period_to', 'format_version', 'created_by',
        'created_at', 'row_count', 'content_sha256', 'signature', 'signing_key_id', 'content'],
  'exports has the contract columns'
);

-- rpc_create_export: a manager, for a managed site ----------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000502', '1 minute');

insert into ids select 'manager_a1', public.rpc_create_export(
  '10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
  array['20000000-0000-4000-8000-0000000005a1']::uuid[], 1,
  pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
    '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]',
    jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000503', '2026-09-01', '20000000-0000-4000-8000-0000000005a1'))),
  decode(repeat('ab', 64), 'hex'), 'test-key');

select results_eq(
  $$select created_by, row_count, site_ids, signing_key_id, content_sha256 = digest(
      convert_to(pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
        '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]',
        jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000503', '2026-09-01', '20000000-0000-4000-8000-0000000005a1'))), 'UTF8'),
      'sha256')
    from public.exports where id = (select id from ids where label = 'manager_a1')$$,
  $$values ('00000000-0000-4000-8000-000000000502'::uuid, 1, array['20000000-0000-4000-8000-0000000005a1']::uuid[], 'test-key'::text, true)$$,
  'a manager stores a snapshot for a managed site; the database computes the sha256 itself'
);

select throws_ok(
  $$select content from public.exports$$,
  '42501', null, 'content is not readable through RLS; only the audited download returns it'
);

select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 2,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]',
      jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000503', '2026-09-01', null))),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '22023', 'row_count_mismatch', 'the row count must match the content'
);

-- Scope: a site-scoped manager cannot export another site ---------------------------------

select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a2']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a2"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'site_not_visible', 'a manager cannot export an unmanaged site'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    null, 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', 'null', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'site_not_visible', 'a manager cannot export the whole organization'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1', '20000000-0000-4000-8000-0000000005a2']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1", "20000000-0000-4000-8000-0000000005a2"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'site_not_visible', 'one unmanaged site in the list is enough to refuse'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 1,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]',
      jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000504', '2026-09-01', null))),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'row_not_visible', 'a row for an employee the manager cannot see is refused'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 1,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]',
      jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000503', '2026-09-01', '20000000-0000-4000-8000-0000000005a2'))),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'row_not_visible', 'a shift at a site outside the export scope is refused'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 1,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]',
      jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000503', '2026-10-01', null))),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '22023', 'invalid_content', 'a row outside the period is refused'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000501',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '22023', 'invalid_content', 'content must name the caller as its creator'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-11-02',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-11-02', '["20000000-0000-4000-8000-0000000005a1"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '22023', 'invalid_period', 'periods above 62 days are refused'
);

-- Size cap -----------------------------------------------------------------------------------

select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    repeat('x', 10485761), decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '22023', 'content_too_large', 'content above 10 MiB is refused before parsing'
);

-- Stale or missing MFA, employees ---------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000502', '13 hours');
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000502',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'not_authorized', 'stale MFA cannot create an export'
);
select throws_ok(
  $$select * from public.rpc_record_export_download((select id from ids where label = 'manager_a1'), 'csv')$$,
  '42501', 'not_authorized', 'stale MFA cannot download an export'
);
select is((select count(*) from public.exports), 0::bigint, 'stale MFA lists no exports');

select pg_temp.login('00000000-0000-4000-8000-000000000502');
select throws_ok(
  $$select * from public.rpc_record_export_download((select id from ids where label = 'manager_a1'), 'csv')$$,
  '42501', 'not_authorized', 'a manager without aal2 cannot download an export'
);

select pg_temp.login('00000000-0000-4000-8000-000000000503', '1 minute');
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000503',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'not_authorized', 'an employee cannot create an export'
);
select is((select count(*) from public.exports), 0::bigint, 'an employee lists no exports');

-- Owner: the whole organization ----------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
insert into ids select 'owner_all', public.rpc_create_export(
  '10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30', null, 2,
  pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000501',
    '2026-09-01', '2026-09-30', 'null',
    jsonb_build_array(
      pg_temp.row('40000000-0000-4000-8000-000000000503', '2026-09-01', '20000000-0000-4000-8000-0000000005a1'),
      pg_temp.row('40000000-0000-4000-8000-000000000504', '2026-09-01', '20000000-0000-4000-8000-0000000005a2'))),
  decode(repeat('cd', 64), 'hex'), 'test-key');
select is((select count(*) from public.exports), 2::bigint, 'the owner lists every export of the organization');
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    null, 1,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000501',
      '2026-09-01', '2026-09-30', 'null',
      jsonb_build_array(pg_temp.row('40000000-0000-4000-8000-000000000505', '2026-09-01', null))),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'row_not_visible', 'a row for an employee of another organization is refused'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a2', '20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000501',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a2", "20000000-0000-4000-8000-0000000005a1"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '22023', 'invalid_sites', 'site lists must be sorted and distinct'
);

select pg_temp.login('00000000-0000-4000-8000-000000000502', '1 minute');
select results_eq(
  $$select id from public.exports$$,
  $$select id from ids where label = 'manager_a1'$$,
  'a manager lists only exports inside their site scope'
);
select throws_ok(
  $$select * from public.rpc_record_export_download((select id from ids where label = 'owner_all'), 'csv')$$,
  '42501', 'not_authorized', 'a manager cannot download a whole-organization export'
);

-- Downloads are audited --------------------------------------------------------------------------

create temporary table downloaded on commit drop as
select * from public.rpc_record_export_download((select id from ids where label = 'manager_a1'), 'json');

select results_eq(
  $$select row_count, content::jsonb ->> 'format_version', length(content_sha256_hex), length(signature_hex), signing_key_id
    from downloaded$$,
  $$values (1, 'cloxa.export.v1'::text, 64, 128, 'test-key'::text)$$,
  'the download returns the stored content, hex sha256 and hex signature'
);
select is(
  encode(digest(convert_to((select content from downloaded), 'UTF8'), 'sha256'), 'hex'),
  (select content_sha256_hex from downloaded),
  'the returned content matches its stored sha256'
);
select results_eq(
  $$select action, entity, actor_user_id, metadata from public.audit_log
    where entity_id = (select id from ids where label = 'manager_a1') order by created_at$$,
  $$values
    ('export.created'::text, 'export'::text, '00000000-0000-4000-8000-000000000502'::uuid,
     jsonb_build_object('period_from', '2026-09-01', 'period_to', '2026-09-30', 'site_count', 1, 'row_count', 1, 'signing_key_id', 'test-key')),
    ('export.downloaded'::text, 'export'::text, '00000000-0000-4000-8000-000000000502'::uuid, '{"format": "json"}'::jsonb)$$,
  'creation and every download each write one audit row'
);
select throws_ok(
  $$select * from public.rpc_record_export_download((select id from ids where label = 'manager_a1'), 'pdf')$$,
  '22023', 'invalid_format', 'only csv and json downloads exist'
);

-- Cross-tenant denial -----------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000505', '1 minute');
select is((select count(*) from public.exports), 0::bigint, 'org B owner sees no org A exports');
select throws_ok(
  $$select * from public.rpc_record_export_download((select id from ids where label = 'manager_a1'), 'csv')$$,
  '42501', 'not_authorized', 'org B owner cannot download an org A export'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-30',
    null, 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050a', '00000000-0000-4000-8000-000000000505',
      '2026-09-01', '2026-09-30', 'null', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'not_authorized', 'org B owner cannot create an export for org A'
);
select throws_ok(
  $$select public.rpc_create_export('10000000-0000-4000-8000-00000000050b', '2026-09-01', '2026-09-30',
    array['20000000-0000-4000-8000-0000000005a1']::uuid[], 0,
    pg_temp.content('10000000-0000-4000-8000-00000000050b', '00000000-0000-4000-8000-000000000505',
      '2026-09-01', '2026-09-30', '["20000000-0000-4000-8000-0000000005a1"]', '[]'),
    decode(repeat('ab', 64), 'hex'), 'test-key')$$,
  '42501', 'site_not_visible', 'org B owner cannot scope an export to an org A site'
);

-- Self export -------------------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000503');
select lives_ok(
  $$select public.rpc_record_self_export('40000000-0000-4000-8000-000000000503', '2026-09-01', '2026-09-30')$$,
  'an employee records a download of their own hours without MFA'
);
select throws_ok(
  $$select public.rpc_record_self_export('40000000-0000-4000-8000-000000000504', '2026-09-01', '2026-09-30')$$,
  '42501', 'not_authorized', 'an employee cannot export a colleague'
);
select throws_ok(
  $$select public.rpc_record_self_export('40000000-0000-4000-8000-000000000503', '2026-09-01', '2026-12-01')$$,
  '22023', 'invalid_period', 'self exports are limited to 62 days'
);
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select throws_ok(
  $$select public.rpc_record_self_export('40000000-0000-4000-8000-000000000503', '2026-09-01', '2026-09-30')$$,
  '42501', 'not_authorized', 'even an owner cannot record a self export for someone else'
);

-- Direct writes and append-only ----------------------------------------------------------------------

select throws_ok(
  $$insert into public.exports (organization_id, period_from, period_to, format_version, created_by, row_count,
      content_sha256, signature, signing_key_id, content)
    values ('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-01', 'cloxa.export.v1',
      '00000000-0000-4000-8000-000000000501', 0, digest('{}', 'sha256'), decode(repeat('ab', 64), 'hex'), 'k', '{}')$$,
  '42501', null, 'authenticated cannot insert exports directly'
);
reset role;

select results_eq(
  $$select action, entity, entity_id, metadata from public.audit_log where action = 'export.self_downloaded'$$,
  $$values ('export.self_downloaded'::text, 'employee'::text, '40000000-0000-4000-8000-000000000503'::uuid,
    '{"format": "csv", "period_to": "2026-09-30", "period_from": "2026-09-01"}'::jsonb)$$,
  'a self export writes one audit row'
);

select throws_ok($$update public.exports set row_count = 99$$, '55000', 'exports is append-only', 'exports are never updated');
select throws_ok($$delete from public.exports$$, '55000', 'exports is append-only', 'exports are never deleted');
select throws_ok($$truncate public.exports$$, '55000', 'exports is append-only', 'exports are never truncated');
select throws_ok(
  $$insert into public.exports (organization_id, period_from, period_to, format_version, created_by, row_count,
      content_sha256, signature, signing_key_id, content)
    values ('10000000-0000-4000-8000-00000000050a', '2026-09-01', '2026-09-01', 'cloxa.export.v1',
      '00000000-0000-4000-8000-000000000501', 0, digest(convert_to(repeat('x', 10485761), 'UTF8'), 'sha256'),
      decode(repeat('ab', 64), 'hex'), 'k', convert_to(repeat('x', 10485761), 'UTF8'))$$,
  '23514', null, 'the table itself refuses content above 10 MiB'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.rpc_record_export_download('90000000-0000-4000-8000-000000000501', 'csv')$$,
  '42501', null, 'anon cannot execute rpc_record_export_download'
);
reset role;

select * from finish();
rollback;
