begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

-- Sign in as p_sub for the rest of the transaction. Without p_mfa_age: aal1
-- (email code only). With p_mfa_age: aal2 with a TOTP verified that long ago.
create function pg_temp.login(p_sub text, p_mfa_age interval default null, p_extra jsonb default '{}')
returns void
language plpgsql
as $$
declare
  v_now bigint := extract(epoch from now())::bigint;
begin
  perform set_config('request.jwt.claims', jsonb_strip_nulls(
    jsonb_build_object(
      'sub', p_sub,
      'role', 'authenticated',
      'aal', case when p_mfa_age is null then 'aal1' else 'aal2' end,
      'amr', case
        when p_mfa_age is null then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', v_now))
        else jsonb_build_array(
          jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now() - p_mfa_age)::bigint),
          jsonb_build_object('method', 'otp', 'timestamp', v_now))
      end
    ) || p_extra
  )::text, true);
end;
$$;

select plan(65);

-- Fixtures (rolled back). Org A: owner u1, admin u2, manager u3 (manages A1),
-- employee u4 (A1), employee u5 (A2, not managed by u3), kiosk-only e7 (A1,
-- PIN 4827, device on A1). Org B: owner u6, employee u8 (B1).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000000e0' || n)::uuid, 'modules-u' || n || '@example.test'
from generate_series(1, 8) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-000000000e0a', 'Modules Org A'),
  ('10000000-0000-4000-8000-000000000e0b', 'Modules Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-000000000ea1', '10000000-0000-4000-8000-000000000e0a', 'Site A1'),
  ('20000000-0000-4000-8000-000000000ea2', '10000000-0000-4000-8000-000000000e0a', 'Site A2'),
  ('20000000-0000-4000-8000-000000000eb1', '10000000-0000-4000-8000-000000000e0b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000e01', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e01', 'owner', 'active'),
  ('30000000-0000-4000-8000-000000000e02', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e02', 'admin', 'active'),
  ('30000000-0000-4000-8000-000000000e03', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e03', 'manager', 'active'),
  ('30000000-0000-4000-8000-000000000e04', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e04', 'employee', 'active'),
  ('30000000-0000-4000-8000-000000000e05', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e05', 'employee', 'active'),
  ('30000000-0000-4000-8000-000000000e06', '10000000-0000-4000-8000-000000000e0b', '00000000-0000-4000-8000-000000000e06', 'owner', 'active'),
  ('30000000-0000-4000-8000-000000000e08', '10000000-0000-4000-8000-000000000e0b', '00000000-0000-4000-8000-000000000e08', 'employee', 'active');

insert into public.employees (id, organization_id, user_id, display_name, statute) values
  ('40000000-0000-4000-8000-000000000e01', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e01', 'Owner A', 'bediende'),
  ('40000000-0000-4000-8000-000000000e04', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e04', 'Student A1', 'student'),
  ('40000000-0000-4000-8000-000000000e05', '10000000-0000-4000-8000-000000000e0a', '00000000-0000-4000-8000-000000000e05', 'Interim A2', 'interim'),
  ('40000000-0000-4000-8000-000000000e07', '10000000-0000-4000-8000-000000000e0a', null, 'Kiosk A1', 'arbeider'),
  ('40000000-0000-4000-8000-000000000e08', '10000000-0000-4000-8000-000000000e0b', '00000000-0000-4000-8000-000000000e08', 'Employee B1', 'interim');

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-000000000e0a', '20000000-0000-4000-8000-000000000ea1', '40000000-0000-4000-8000-000000000e04', null),
  ('10000000-0000-4000-8000-000000000e0a', '20000000-0000-4000-8000-000000000ea2', '40000000-0000-4000-8000-000000000e05', null),
  ('10000000-0000-4000-8000-000000000e0a', '20000000-0000-4000-8000-000000000ea1', '40000000-0000-4000-8000-000000000e07', null),
  ('10000000-0000-4000-8000-000000000e0b', '20000000-0000-4000-8000-000000000eb1', '40000000-0000-4000-8000-000000000e08', null),
  ('10000000-0000-4000-8000-000000000e0a', '20000000-0000-4000-8000-000000000ea1', null, '30000000-0000-4000-8000-000000000e03');

-- A paired kiosk on A1 (secret = 64 x 'a') and a PIN for the kiosk-only worker.
insert into public.kiosk_devices (id, organization_id, site_id, name, secret_hash, created_by) values
  ('60000000-0000-4000-8000-000000000e01', '10000000-0000-4000-8000-000000000e0a', '20000000-0000-4000-8000-000000000ea1',
   'Tablet', extensions.digest(decode(repeat('a', 64), 'hex'), 'sha256'), '00000000-0000-4000-8000-000000000e01');
insert into public.employee_pins (employee_id, organization_id, pin_hash, set_by) values
  ('40000000-0000-4000-8000-000000000e07', '10000000-0000-4000-8000-000000000e0a',
   extensions.crypt('4827', extensions.gen_salt('bf', 10)), '00000000-0000-4000-8000-000000000e01');

create temporary table r (label text primary key, id uuid) on commit drop;
grant select, insert on r to authenticated, anon;

-- Structure --------------------------------------------------------------------------------

select ok(
  (select bool_and(relrowsecurity) from pg_catalog.pg_class
   where oid in ('public.org_modules'::regclass, 'public.employee_module_data'::regclass)),
  'RLS is on for both module tables'
);
select ok(
  not has_table_privilege('authenticated', 'public.org_modules', 'INSERT,UPDATE,DELETE')
    and not has_table_privilege('authenticated', 'public.employee_module_data', 'INSERT,UPDATE,DELETE'),
  'authenticated cannot write module tables directly'
);
select throws_ok(
  $$insert into public.org_modules (organization_id, module, enabled, updated_by)
    values ('10000000-0000-4000-8000-000000000e0a', 'ciao', true, '00000000-0000-4000-8000-000000000e01')$$,
  '23514', null, 'the table refuses a module outside the allowlist'
);
select throws_ok(
  $$insert into public.employee_module_data (organization_id, employee_id, module, data, updated_by)
    values ('10000000-0000-4000-8000-000000000e0b', '40000000-0000-4000-8000-000000000e04', 'student', '{}',
      '00000000-0000-4000-8000-000000000e01')$$,
  '23503', null, 'composite FK refuses module data for another organization''s employee'
);

-- Org modules: owner/admin with fresh MFA ------------------------------------------------------

set local role authenticated;

select pg_temp.login('00000000-0000-4000-8000-000000000e01', '1 minute');
select lives_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'student', true, '{}')$$,
  'the owner enables student'
);
select lives_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'overuren', true, '{"sector": "horeca"}')$$,
  'the owner enables overuren with a config'
);
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'ciao', true, '{}')$$,
  '22023', 'invalid_module', 'a module outside the allowlist is refused'
);
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'student', true, '[1, 2]')$$,
  '22023', 'invalid_config', 'a config that is not a JSON object is refused'
);
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'student', true,
      jsonb_build_object('note', repeat('x', 8200)))$$,
  '22023', 'invalid_config', 'a config above 8 KiB is refused'
);
select lives_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'student', true,
      jsonb_build_object('note', repeat('x', 8000)))$$,
  'a config just under 8 KiB is accepted'
);
select lives_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'student', true, '{}')$$,
  'setting a module again updates it'
);
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0b', 'student', true, '{}')$$,
  '42501', 'not_authorized', 'an owner cannot set another organization''s modules'
);

select pg_temp.login('00000000-0000-4000-8000-000000000e02', '1 minute');
select lives_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'interim', true, null)$$,
  'an admin enables interim (null config is an empty object)'
);

select pg_temp.login('00000000-0000-4000-8000-000000000e01', '13 hours');
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'telework', true, '{}')$$,
  '42501', 'not_authorized', 'stale MFA: the owner cannot set a module'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e01');
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'telework', true, '{}')$$,
  '42501', 'not_authorized', 'no MFA at all: the owner cannot set a module'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e03', '1 minute');
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'telework', true, '{}')$$,
  '42501', 'not_authorized', 'a manager cannot set a module'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e04');
select throws_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'telework', true, '{}')$$,
  '42501', 'not_authorized', 'an employee cannot set a module'
);

-- Every active member reads their own organization's modules, nobody else's.
select results_eq(
  $$select module, enabled from public.org_modules order by module$$,
  $$values ('interim'::text, true), ('overuren', true), ('student', true)$$,
  'an employee reads their organization''s modules'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e06', '1 minute');
select is_empty(
  $$select 1 from public.org_modules where organization_id = '10000000-0000-4000-8000-000000000e0a'$$,
  'cross-tenant: the owner of B sees none of A''s modules'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e07');
select is_empty($$select 1 from public.org_modules$$, 'a login without membership sees no modules');

reset role;
select results_eq(
  $$select metadata from public.audit_log
    where action = 'organization.module_updated' and entity_id = '10000000-0000-4000-8000-000000000e0a'
      and metadata ->> 'module' = 'overuren'$$,
  $$values ('{"module": "overuren", "enabled": true, "config_keys": ["sector"]}'::jsonb)$$,
  'switching a module is audited with the config keys, not the values'
);
select is(
  (select count(*) from public.audit_log
   where action = 'organization.module_updated' and entity_id = '10000000-0000-4000-8000-000000000e0a'),
  5::bigint, 'every successful switch wrote one audit row; refusals wrote none'
);

-- Employee module data -------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000e03', '1 minute');
select lives_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'student', '{"note": "tweede jaar"}')$$,
  'a manager sets module data for an employee on a managed site'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e05', 'interim',
      '{"agency_name": "Uitzend NV"}')$$,
  '42501', 'not_authorized', 'a manager cannot set data for an employee outside their sites'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'flexi', '{}')$$,
  '22023', 'module_disabled', 'data for a module that is off is refused'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'bouw', '{}')$$,
  '22023', 'invalid_module', 'data for a module outside the allowlist is refused'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'student', '"text"')$$,
  '22023', 'invalid_data', 'module data must be a JSON object'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'student',
      jsonb_build_object('note', repeat('x', 8200)))$$,
  '22023', 'invalid_data', 'module data above 8 KiB is refused'
);

select pg_temp.login('00000000-0000-4000-8000-000000000e01', '1 minute');
select lives_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e05', 'interim',
      '{"agency_name": "Uitzend NV", "agency_reference": "UZ-77"}')$$,
  'the owner sets interim data for any employee of the organization'
);
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e08', 'interim', '{}')$$,
  '42501', 'not_authorized', 'cross-tenant: the owner of A cannot write B''s employee'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e01', '13 hours');
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'student', '{}')$$,
  '42501', 'not_authorized', 'stale MFA: module data cannot be written'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e04');
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e04', 'student', '{"note": "zelf"}')$$,
  '42501', 'not_authorized', 'an employee cannot write their own module data'
);

-- Reads: self, managed sites, whole org; never another tenant.
select results_eq(
  $$select employee_id, module, data from public.employee_module_data$$,
  $$values ('40000000-0000-4000-8000-000000000e04'::uuid, 'student'::text, '{"note": "tweede jaar"}'::jsonb)$$,
  'an employee reads only their own module data'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e03', '1 minute');
select results_eq(
  $$select employee_id from public.employee_module_data order by employee_id$$,
  $$values ('40000000-0000-4000-8000-000000000e04'::uuid)$$,
  'a manager reads module data of employees on managed sites only'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e03', '13 hours');
select is_empty(
  $$select 1 from public.employee_module_data$$,
  'stale MFA: a manager without their own data reads none'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e02', '1 minute');
select is(
  (select count(*) from public.employee_module_data), 2::bigint,
  'an admin reads the whole organization''s module data'
);
select pg_temp.login('00000000-0000-4000-8000-000000000e06', '1 minute');
select is_empty(
  $$select 1 from public.employee_module_data where organization_id = '10000000-0000-4000-8000-000000000e0a'$$,
  'cross-tenant: the owner of B reads none of A''s module data'
);

reset role;
select results_eq(
  $$select metadata from public.audit_log
    where action = 'employee.module_data_updated' and entity_id = '40000000-0000-4000-8000-000000000e05'$$,
  $$values ('{"employee_id": "40000000-0000-4000-8000-000000000e05", "module": "interim",
             "field_keys": ["agency_name", "agency_reference"]}'::jsonb)$$,
  'module data is audited with field keys only, never the values'
);

-- Telework: a work location only when enabled --------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000e04');
select throws_ok(
  $$select public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000e01', '20000000-0000-4000-8000-000000000ea1',
      null, 'home')$$,
  '22023', 'telework_disabled', 'a work location is refused while telework is off'
);
select throws_ok(
  $$select * from public.rpc_clock_offline('clock_in', '50000000-0000-4000-8000-000000000e02',
      '20000000-0000-4000-8000-000000000ea1', now() - interval '5 minutes', 'home')$$,
  '22023', 'telework_disabled', 'an offline work location is refused while telework is off'
);
select is_empty(
  $$select 1 from public.clock_events where employee_id = '40000000-0000-4000-8000-000000000e04'$$,
  'nothing was recorded by the refused clock-ins'
);

select pg_temp.login('00000000-0000-4000-8000-000000000e01', '1 minute');
select lives_ok(
  $$select public.rpc_set_org_module('10000000-0000-4000-8000-000000000e0a', 'telework', true, '{}')$$,
  'the owner enables telework'
);

select pg_temp.login('00000000-0000-4000-8000-000000000e04');
select throws_ok(
  $$select public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000e03', '20000000-0000-4000-8000-000000000ea1',
      null, 'garden')$$,
  '22023', 'invalid_work_location', 'only site or home'
);
insert into r select 'home_in', (public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000e04',
  '20000000-0000-4000-8000-000000000ea1', null, 'home')).id;
select is(
  (select work_location from public.clock_events where id = (select id from r where label = 'home_in')),
  'home', 'with telework on, a clock-in records home'
);
select throws_ok(
  $$select public.rpc_clock('clock_out', '50000000-0000-4000-8000-000000000e05', '20000000-0000-4000-8000-000000000ea1',
      null, 'home')$$,
  '22023', 'invalid_work_location', 'a work location only goes with a clock-in'
);
insert into r select 'home_out', (public.rpc_clock('clock_out', '50000000-0000-4000-8000-000000000e06',
  '20000000-0000-4000-8000-000000000ea1')).id;
select is(
  (select public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000e04', '20000000-0000-4000-8000-000000000ea1',
     null, 'home')).id,
  (select id from r where label = 'home_in'),
  'a replayed key returns the original event'
);

reset role;
select results_eq(
  $$select metadata ->> 'work_location' from public.audit_log where entity_id = (select id from r where label = 'home_in')$$,
  $$values ('home'::text)$$,
  'the audit row of the clock-in names the location'
);

-- An adjust correction of a clock-in keeps its location (inserted as the approval would).
insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source,
  supersedes_event_id, actor_user_id, idempotency_key, prev_hash, hash)
select organization_id, site_id, employee_id, 'clock_in', occurred_at - interval '10 minutes', 'correction',
  id, '00000000-0000-4000-8000-000000000e01', gen_random_uuid(), '\x00', '\x00'
from public.clock_events where id = (select id from r where label = 'home_in');
select is(
  (select work_location from public.clock_events where supersedes_event_id = (select id from r where label = 'home_in')),
  'home', 'moving a clock-in by correction keeps where the shift was worked'
);

-- Offline, with telework on.
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000e05');
select results_eq(
  $$select outcome from public.rpc_clock_offline('clock_in', '50000000-0000-4000-8000-000000000e07',
      '20000000-0000-4000-8000-000000000ea2', now() - interval '5 minutes', 'site')$$,
  $$values ('recorded'::text)$$,
  'an offline clock-in records its location'
);
select is(
  (select work_location from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000e07'),
  'site', 'the offline row carries site'
);

-- The kiosk stands at a site.
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(repeat('a', 64), '40000000-0000-4000-8000-000000000e07', '4827',
      'clock_in', '50000000-0000-4000-8000-000000000e08', 'home')$$,
  $$values (false, 'invalid_input'::text)$$,
  'a kiosk never records home'
);
select results_eq(
  $$select ok, state from public.rpc_kiosk_clock(repeat('a', 64), '40000000-0000-4000-8000-000000000e07', '4827',
      'clock_in', '50000000-0000-4000-8000-000000000e09')$$,
  $$values (true, 'working'::text)$$,
  'a kiosk clock-in works without a location'
);
reset role;
select is(
  (select work_location from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000e09'),
  'site', 'with telework on, a kiosk clock-in is recorded at the site'
);

-- Chain: mixed rows verify, old rows keep their bytes --------------------------------------------

select is(
  (select array[
     count(*) filter (where work_location is null and not offline),
     count(*) filter (where work_location is not null and not offline),
     count(*) filter (where work_location is not null and offline)]
   from public.clock_events where organization_id = '10000000-0000-4000-8000-000000000e0a'),
  array[1, 3, 1]::bigint[], 'org A has rows with and without a location, online and offline, in one chain'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-000000000e0a'), null, 'the mixed chain verifies');
select is(
  (select count(*) from public.organizations where private.verify_clock_chain(id) is not null),
  0::bigint, 'every clock chain in this database still verifies (rows from before the column included)'
);
select is(
  (select hash from public.clock_events where id = (select id from r where label = 'home_in')),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '||' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|' || '|work_location=home',
      'UTF8'),
    'sha256') from public.clock_events where id = (select id from r where label = 'home_in')),
  'a located row: the 14 contract fields plus |work_location=home'
);
select is(
  (select hash from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000e07'),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from client_captured_at) * 1000000)::bigint)::text
      || '|' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|' || '|offline|work_location=site',
      'UTF8'),
    'sha256') from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000e07'),
  'an offline located row: |offline, then |work_location=site'
);
select is(
  (select hash from public.clock_events where id = (select id from r where label = 'home_out')),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '||' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|',
      'UTF8'),
    'sha256') from public.clock_events where id = (select id from r where label = 'home_out')),
  'a row without a location keeps exactly the old canonical bytes'
);

alter table public.clock_events disable trigger clock_events_reject_update_delete;
update public.clock_events set work_location = 'site' where id = (select id from r where label = 'home_in');
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-000000000e0a'),
  (select id from r where label = 'home_in'),
  'changing home into site afterwards is detected'
);
update public.clock_events set work_location = 'home' where id = (select id from r where label = 'home_in');
alter table public.clock_events enable trigger clock_events_reject_update_delete;

-- Data-subject access and anonymisation ---------------------------------------------------------

select ok(
  (select jsonb_array_length(doc -> 'module_data') = 1
     and doc #>> '{module_data,0,data,agency_reference}' = 'UZ-77'
   from (select private.subject_document('40000000-0000-4000-8000-000000000e05') as doc) as subject),
  'the subject export carries the employee''s module data'
);
select ok(
  (select bool_or(event ->> 'work_location' = 'home')
   from jsonb_array_elements(private.subject_document('40000000-0000-4000-8000-000000000e04') -> 'clock_events') as event),
  'the subject export carries work locations'
);

update public.employees
set active = false, left_at = current_date - 1, user_id = null, anonymised_at = now()
where id = '40000000-0000-4000-8000-000000000e05';
select is_empty(
  $$select 1 from public.employee_module_data where employee_id = '40000000-0000-4000-8000-000000000e05'$$,
  'anonymising an employee deletes their module data'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000e01', '1 minute');
select throws_ok(
  $$select public.rpc_set_employee_module_data('40000000-0000-4000-8000-000000000e05', 'interim', '{"agency_name": "X"}')$$,
  '22023', 'employee_anonymised', 'an anonymised employee gets no new module data'
);

-- Anonymous ------------------------------------------------------------------------------------

reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select 1 from public.org_modules$$,
  '42501', null, 'anon cannot read modules'
);

select * from finish();
rollback;
