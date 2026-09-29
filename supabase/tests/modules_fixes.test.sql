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

-- An export of org A for September, created by the owner (u1), with these
-- rows, header modules and agency. Only keys the database checks.
create function pg_temp.export_content(p_rows jsonb, p_modules jsonb, p_agency text)
returns text
language sql
as $$
  select (
    jsonb_build_object(
      'format_version', 'cloxa.export.v1',
      'organization_id', '10000000-0000-4000-8000-000000000f0a',
      'created_by', '00000000-0000-4000-8000-000000000f01',
      'generated_at', '2026-10-01T08:00:00.000Z',
      'period', jsonb_build_object('from', '2026-09-01', 'to', '2026-09-30', 'timezone', 'Europe/Brussels'),
      'site_ids', null,
      'rows', p_rows
    )
    || case when p_modules is null then '{}'::jsonb else jsonb_build_object('modules', p_modules) end
    || case when p_agency is null then '{}'::jsonb else jsonb_build_object('interim_agency', p_agency) end
  )::text;
$$;

create function pg_temp.export_row(p_employee text, p_modules jsonb default '{}')
returns jsonb
language sql
as $$
  select jsonb_build_object('day', '2026-09-01', 'employee_id', p_employee, 'shifts', '[]'::jsonb)
    || case when p_modules is null then '{}'::jsonb else jsonb_build_object('modules', p_modules) end;
$$;

create function pg_temp.create_export(p_content text, p_rows integer, p_agency text)
returns uuid
language sql
as $$
  select public.rpc_create_export(
    '10000000-0000-4000-8000-000000000f0a', '2026-09-01', '2026-09-30', null, p_rows, p_content,
    decode(repeat('ab', 64), 'hex'), 'test', p_agency);
$$;

grant execute on function pg_temp.export_content(jsonb, jsonb, text) to authenticated;
grant execute on function pg_temp.export_row(text, jsonb) to authenticated;
grant execute on function pg_temp.create_export(text, integer, text) to authenticated;

select plan(25);

-- Fixtures (rolled back). Org A: owner u1; interim workers u2 and u3 (A1),
-- student u4 (A1), bediende u5 (A1), kiosk-only e6 (A1, PIN 4827, device on
-- A1). Interim and student on; telework off at first.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000000f0' || n)::uuid, 'fixes-u' || n || '@example.test'
from generate_series(1, 5) as n;

insert into public.organizations (id, name) values ('10000000-0000-4000-8000-000000000f0a', 'Fixes Org A');
insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-000000000fa1', '10000000-0000-4000-8000-000000000f0a', 'Site A1');

insert into public.memberships (organization_id, user_id, role, status)
select '10000000-0000-4000-8000-000000000f0a', ('00000000-0000-4000-8000-000000000f0' || n)::uuid,
  case when n = 1 then 'owner' else 'employee' end, 'active'
from generate_series(1, 5) as n;

insert into public.employees (id, organization_id, user_id, display_name, statute) values
  ('40000000-0000-4000-8000-000000000f02', '10000000-0000-4000-8000-000000000f0a', '00000000-0000-4000-8000-000000000f02', 'Interim Een', 'interim'),
  ('40000000-0000-4000-8000-000000000f03', '10000000-0000-4000-8000-000000000f0a', '00000000-0000-4000-8000-000000000f03', 'Interim Twee', 'interim'),
  ('40000000-0000-4000-8000-000000000f04', '10000000-0000-4000-8000-000000000f0a', '00000000-0000-4000-8000-000000000f04', 'Student', 'student'),
  ('40000000-0000-4000-8000-000000000f05', '10000000-0000-4000-8000-000000000f0a', '00000000-0000-4000-8000-000000000f05', 'Bediende', 'bediende'),
  ('40000000-0000-4000-8000-000000000f06', '10000000-0000-4000-8000-000000000f0a', null, 'Kiosk', 'arbeider');

insert into public.site_assignments (organization_id, site_id, employee_id)
select '10000000-0000-4000-8000-000000000f0a', '20000000-0000-4000-8000-000000000fa1',
  ('40000000-0000-4000-8000-000000000f0' || n)::uuid
from generate_series(2, 6) as n;

insert into public.kiosk_devices (id, organization_id, site_id, name, secret_hash, created_by) values
  ('60000000-0000-4000-8000-000000000f01', '10000000-0000-4000-8000-000000000f0a', '20000000-0000-4000-8000-000000000fa1',
   'Tablet', extensions.digest(decode(repeat('b', 64), 'hex'), 'sha256'), '00000000-0000-4000-8000-000000000f01');
insert into public.employee_pins (employee_id, organization_id, pin_hash, set_by) values
  ('40000000-0000-4000-8000-000000000f06', '10000000-0000-4000-8000-000000000f0a',
   extensions.crypt('4827', extensions.gen_salt('bf', 10)), '00000000-0000-4000-8000-000000000f01');

insert into public.org_modules (organization_id, module, enabled, updated_by) values
  ('10000000-0000-4000-8000-000000000f0a', 'interim', true, '00000000-0000-4000-8000-000000000f01'),
  ('10000000-0000-4000-8000-000000000f0a', 'student', true, '00000000-0000-4000-8000-000000000f01');

-- Written before the statute rule existed: interim data on a bediende.
insert into public.employee_module_data (organization_id, employee_id, module, data, updated_by) values
  ('10000000-0000-4000-8000-000000000f0a', '40000000-0000-4000-8000-000000000f05', 'interim',
   '{"agency_name": "Uitzend B"}', '00000000-0000-4000-8000-000000000f01');

-- Module data: audit digests and agency names, statutes, control characters ----------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000f01', '1 minute');

select lives_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f02', 'interim', '{"agency_name": "Uitzend A"}')$$,
  'the owner sets an interim worker''s agency'
);
select lives_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f02', 'interim', '{"agency_name": "Uitzend B"}')$$,
  'and changes it'
);
select lives_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f03', 'interim', '{"agency_name": "Uitzend C"}')$$,
  'a second interim worker at another agency'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f05', 'student', '{}')$$,
  '22023', 'module_not_applicable', 'student data for a bediende is refused'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f04', 'interim', '{"agency_name": "X"}')$$,
  '22023', 'module_not_applicable', 'interim data for a student is refused'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f02', 'interim',
      jsonb_build_object('agency_name', 'Uitzend' || chr(10) || '=cmd'))$$,
  '22023', 'invalid_data', 'a control character in an agency name is refused'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000f02', 'interim',
      jsonb_build_object('agency_name', 'Uitzend', 'agency_reference', 'R' || chr(127)))$$,
  '22023', 'invalid_data', 'a control character in an agency reference is refused'
);

reset role;
select results_eq(
  $$select metadata ->> 'agency_name_old', metadata ->> 'agency_name_new',
           metadata ->> 'old_sha256', metadata ->> 'new_sha256'
    from public.audit_log
    where action = 'employee.module_data_updated' and entity_id = '40000000-0000-4000-8000-000000000f02'
    order by created_at$$,
  $$values
    (null::text, 'Uitzend A'::text, null::text,
     encode(extensions.digest(convert_to('{"agency_name": "Uitzend A"}', 'UTF8'), 'sha256'), 'hex')),
    ('Uitzend A', 'Uitzend B',
     encode(extensions.digest(convert_to('{"agency_name": "Uitzend A"}', 'UTF8'), 'sha256'), 'hex'),
     encode(extensions.digest(convert_to('{"agency_name": "Uitzend B"}', 'UTF8'), 'sha256'), 'hex'))$$,
  'an agency change logs both names and both digests'
);

-- rpc_create_export with an agency ----------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000f01', '1 minute');

select lives_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02')),
        '["interim"]', 'Uitzend B'), 1, 'Uitzend B')$$,
  'an agency export of that agency''s interim worker is stored'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f03')),
        '["interim"]', 'Uitzend B'), 1, 'Uitzend B')$$,
  '42501', 'row_not_visible', 'a worker of another agency is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f05')),
        '["interim"]', 'Uitzend B'), 1, 'Uitzend B')$$,
  '42501', 'row_not_visible', 'someone with that agency but not the interim statute is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02')),
        '["student"]', 'Uitzend B'), 1, 'Uitzend B')$$,
  '22023', 'invalid_content', 'an agency export whose header lacks interim is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02', null)),
        '["interim"]', 'Uitzend B'), 1, 'Uitzend B')$$,
  '22023', 'invalid_content', 'a row without modules under a header with modules is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02')),
        null, null), 1, null)$$,
  '22023', 'invalid_content', 'a row with modules under a header without them is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02',
        '{"telework": {}}')), '["interim"]', 'Uitzend B'), 1, 'Uitzend B')$$,
  '22023', 'invalid_content', 'a row module that the header does not list is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02')),
        '["interim"]', 'Uitzend C'), 1, 'Uitzend B')$$,
  '22023', 'invalid_content', 'a header agency other than the requested one is refused'
);
select throws_ok(
  $$select pg_temp.create_export(
      pg_temp.export_content(jsonb_build_array(pg_temp.export_row('40000000-0000-4000-8000-000000000f02')),
        '["interim"]', 'Uitzend' || chr(9) || 'B'), 1, 'Uitzend' || chr(9) || 'B')$$,
  '22023', 'invalid_interim_agency', 'a control character in the agency is refused'
);

reset role;
select is(
  (select array_agg(interim_agency) from public.exports where organization_id = '10000000-0000-4000-8000-000000000f0a'),
  array['Uitzend B'], 'only the valid agency export was stored, with its agency'
);
select throws_ok(
  $$insert into public.exports (organization_id, period_from, period_to, format_version, created_by, row_count,
      content_sha256, signature, signing_key_id, content, interim_agency)
    values ('10000000-0000-4000-8000-000000000f0a', '2026-09-01', '2026-09-30', 'cloxa.export.v1',
      '00000000-0000-4000-8000-000000000f01', 0, extensions.digest('\x7b7d'::bytea, 'sha256'),
      decode(repeat('ab', 64), 'hex'), 'test', '\x7b7d'::bytea, 'A' || chr(27))$$,
  '23514', null, 'the table refuses a control character in interim_agency'
);

-- Kiosk with telework off, and a replay with another location ------------------------------

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select results_eq(
  $$select ok from public.rpc_kiosk_clock(repeat('b', 64), '40000000-0000-4000-8000-000000000f06', '4827',
      'clock_in', '50000000-0000-4000-8000-000000000f01', 'site')$$,
  $$values (true)$$,
  'a kiosk clock-in with site works while telework is off'
);
reset role;
select is(
  (select work_location from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000f01'),
  null, 'with telework off, the kiosk''s site is dropped: no location is recorded'
);

insert into public.org_modules (organization_id, module, enabled, updated_by) values
  ('10000000-0000-4000-8000-000000000f0a', 'telework', true, '00000000-0000-4000-8000-000000000f01');

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000f04');
create temporary table first_event on commit drop as
select * from public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000f02',
  '20000000-0000-4000-8000-000000000fa1', null, 'home');
select is(
  (select id from public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000f02',
     '20000000-0000-4000-8000-000000000fa1', null, 'site')),
  (select id from first_event),
  'a replay with another location returns the original event'
);
reset role;
select is(
  (select work_location from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000f02'),
  'home', 'and the original location stays'
);
select is(
  (select count(*) from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000f02'),
  1::bigint, 'nothing was recorded twice'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-000000000f0a'), null, 'the chain verifies');

select * from finish();
rollback;
