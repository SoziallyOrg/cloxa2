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

select plan(122);

-- Fixtures (rolled back). Org A: owner u1 (A1), admin u2, manager u3 (manages
-- A1), employee u4 (A1), employee u5 (A2), suspended u7 (A1), kiosk-only e8
-- (A1) and e9 (A2), a second manager u9 (employee row on A1). Org B: owner u6
-- (B1). u8 is an employee of both orgs (no site). The admin has an employee row.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000090' || n)::uuid, 'kiosk-u' || n || '@example.test'
from generate_series(1, 9) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000090a', 'Kiosk Org A'),
  ('10000000-0000-4000-8000-00000000090b', 'Kiosk Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000009a1', '10000000-0000-4000-8000-00000000090a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000009a2', '10000000-0000-4000-8000-00000000090a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000009b1', '10000000-0000-4000-8000-00000000090b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000090' || n)::uuid,
  case when n = 6 then '10000000-0000-4000-8000-00000000090b' else '10000000-0000-4000-8000-00000000090a' end::uuid,
  ('00000000-0000-4000-8000-00000000090' || n)::uuid,
  (array['owner', 'admin', 'manager', 'employee', 'employee', 'owner', 'employee'])[n],
  case when n = 7 then 'suspended' else 'active' end
from generate_series(1, 7) as n;

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000908', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000908', 'employee', 'active'),
  ('30000000-0000-4000-8000-000000000918', '10000000-0000-4000-8000-00000000090b', '00000000-0000-4000-8000-000000000908', 'employee', 'active'),
  ('30000000-0000-4000-8000-000000000909', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000909', 'manager', 'active');

insert into public.employees (id, organization_id, user_id, display_name) values
  ('40000000-0000-4000-8000-000000000902', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000902', 'Ada Admin'),
  ('40000000-0000-4000-8000-000000000918', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000908', 'Tom Twee A'),
  ('40000000-0000-4000-8000-000000000928', '10000000-0000-4000-8000-00000000090b', '00000000-0000-4000-8000-000000000908', 'Tom Twee B'),
  ('40000000-0000-4000-8000-000000000919', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000909', 'Mira Manager'),
  ('40000000-0000-4000-8000-000000000901', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000901', 'Olga Owner'),
  ('40000000-0000-4000-8000-000000000903', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000903', 'Mo Manager'),
  ('40000000-0000-4000-8000-000000000904', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000904', 'Emma van Dijk'),
  ('40000000-0000-4000-8000-000000000905', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000905', 'Elias Tweede'),
  ('40000000-0000-4000-8000-000000000906', '10000000-0000-4000-8000-00000000090b', '00000000-0000-4000-8000-000000000906', 'Bea Owner'),
  ('40000000-0000-4000-8000-000000000907', '10000000-0000-4000-8000-00000000090a', '00000000-0000-4000-8000-000000000907', 'Sven Suspended'),
  ('40000000-0000-4000-8000-000000000908', '10000000-0000-4000-8000-00000000090a', null, 'Karel Kiosk'),
  ('40000000-0000-4000-8000-000000000909', '10000000-0000-4000-8000-00000000090a', null, 'Nina Negen');

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', '40000000-0000-4000-8000-000000000901', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', '40000000-0000-4000-8000-000000000904', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a2', '40000000-0000-4000-8000-000000000905', null),
  ('10000000-0000-4000-8000-00000000090b', '20000000-0000-4000-8000-0000000009b1', '40000000-0000-4000-8000-000000000906', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', '40000000-0000-4000-8000-000000000907', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', '40000000-0000-4000-8000-000000000908', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a2', '40000000-0000-4000-8000-000000000909', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', '40000000-0000-4000-8000-000000000919', null),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', null, '30000000-0000-4000-8000-000000000903'),
  ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1', null, '30000000-0000-4000-8000-000000000909');

-- Values carried between steps (codes, secrets), keyed by label.
create temporary table k (label text primary key, value text) on commit drop;
grant select, insert, update on k to anon, authenticated;

create function pg_temp.v(p_label text) returns text language sql as $$
  select value from k where label = p_label;
$$;

create function pg_temp.as_anon() returns void language plpgsql as $$
begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
end;
$$;

-- Structure and grants --------------------------------------------------------------------

select ok(
  not has_column_privilege('authenticated', 'public.kiosk_devices', 'secret_hash', 'SELECT')
    and not has_column_privilege('anon', 'public.kiosk_devices', 'secret_hash', 'SELECT')
    and not has_column_privilege('service_role', 'public.kiosk_devices', 'secret_hash', 'SELECT'),
  'no API role can select kiosk_devices.secret_hash'
);
select ok(
  not has_column_privilege('authenticated', 'public.employee_pins', 'pin_hash', 'SELECT')
    and not has_column_privilege('anon', 'public.employee_pins', 'pin_hash', 'SELECT')
    and not has_column_privilege('service_role', 'public.employee_pins', 'pin_hash', 'SELECT'),
  'no API role can select employee_pins.pin_hash'
);
select ok(
  not has_table_privilege('authenticated', 'private.kiosk_pairing_codes', 'SELECT')
    and not has_table_privilege('anon', 'private.kiosk_pairing_codes', 'SELECT')
    and not has_table_privilege('authenticated', 'private.kiosk_attempts', 'SELECT')
    and not has_table_privilege('anon', 'private.kiosk_attempts', 'SELECT'),
  'pairing codes and attempts are not readable by API roles'
);
select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and has_function_privilege('anon', p.oid, 'EXECUTE')
    order by 1
  ),
  array[
    'rpc_kiosk_clock(text,uuid,text,text,uuid,text)',
    'rpc_kiosk_pair(text)',
    'rpc_kiosk_roster(text)',
    'rpc_kiosk_status(text,uuid,text)'
  ],
  'anon executes exactly the four kiosk RPCs'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, idempotency_key, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000090a', '20000000-0000-4000-8000-0000000009a1',
      '40000000-0000-4000-8000-000000000904', 'clock_in', now(), 'app', gen_random_uuid(), '\x00', '\x00')$$,
  '23514', null, 'a clock event without an actor is refused unless it is a kiosk event'
);

-- PIN rules ----------------------------------------------------------------------------------

select is(
  array(
    select coalesce(private.pin_problem(candidate), 'ok')
    from unnest(array[
      '1234', '4321', '0000', '123456', '987654', '0123', '99999',
      '2580', '1357', '9012', '1243', '102030',
      '123', '1234567', '12a4', '', ' 1234', '١٢٣٤'
    ]) with ordinality as input (candidate, n)
    order by n
  ),
  array[
    'pin_too_simple', 'pin_too_simple', 'pin_too_simple', 'pin_too_simple', 'pin_too_simple', 'pin_too_simple', 'pin_too_simple',
    'ok', 'ok', 'ok', 'ok', 'ok',
    'pin_invalid_format', 'pin_invalid_format', 'pin_invalid_format', 'pin_invalid_format', 'pin_invalid_format', 'pin_invalid_format'
  ],
  'PINs: 4-6 ASCII digits, not all equal, not a straight run'
);
select is(private.pin_problem(null), 'pin_invalid_format', 'a null PIN is refused');

-- Creating kiosks ----------------------------------------------------------------------------

set local role authenticated;

select pg_temp.login('00000000-0000-4000-8000-000000000903', '1 minute');
select throws_ok(
  $$select * from public.rpc_kiosk_create('20000000-0000-4000-8000-0000000009a1', 'Ingang')$$,
  '42501', 'not_authorized', 'a manager cannot create kiosks'
);

select pg_temp.login('00000000-0000-4000-8000-000000000902');
select throws_ok(
  $$select * from public.rpc_kiosk_create('20000000-0000-4000-8000-0000000009a1', 'Ingang')$$,
  '42501', 'not_authorized', 'an admin without fresh MFA cannot create kiosks'
);

select pg_temp.login('00000000-0000-4000-8000-000000000902', '1 minute');
select throws_ok(
  $$select * from public.rpc_kiosk_create('20000000-0000-4000-8000-0000000009a1', '   ')$$,
  '22023', 'invalid_name', 'a kiosk needs a name'
);

with created as (
  select * from public.rpc_kiosk_create('20000000-0000-4000-8000-0000000009a1', ' Ingang ')
)
insert into k
select 'deviceA', device_id::text from created
union all
select 'codeA', pairing_code from created
union all
select 'codeA_ttl', (expires_at - clock_timestamp())::text from created;

select ok(pg_temp.v('codeA') ~ '^[A-HJ-NP-Z2-9]{8}$', 'the pairing code is 8 characters from the unambiguous alphabet');
select ok(
  pg_temp.v('codeA_ttl')::interval between interval '9 minutes 50 seconds' and interval '10 minutes',
  'the pairing code is valid for 10 minutes'
);
select lives_ok(
  $$insert into k select 'codeA2', pairing_code from public.rpc_kiosk_new_pairing_code(pg_temp.v('deviceA')::uuid)$$,
  'an admin issues a new pairing code, replacing the first'
);

select results_eq(
  $$select name, status, site_id, created_by, last_seen_at is null from public.kiosk_devices$$,
  $$values ('Ingang'::text, 'active'::text, '20000000-0000-4000-8000-0000000009a1'::uuid,
    '00000000-0000-4000-8000-000000000902'::uuid, true)$$,
  'the admin sees the new kiosk (name trimmed, not yet seen)'
);
select throws_ok(
  $$select secret_hash from public.kiosk_devices$$,
  '42501', null, 'secret_hash is not selectable, even for the admin'
);
select is(
  (select count(*) from public.audit_log where action = 'kiosk.created' and entity_id = pg_temp.v('deviceA')::uuid),
  1::bigint, 'kiosk creation is audited'
);

select pg_temp.login('00000000-0000-4000-8000-000000000903', '1 minute');
select is((select count(*) from public.kiosk_devices), 1::bigint, 'a manager sees the kiosks of a managed site');

select pg_temp.login('00000000-0000-4000-8000-000000000904');
select is((select count(*) from public.kiosk_devices), 0::bigint, 'an employee sees no kiosks');

-- Cross-tenant: owner B.
select pg_temp.login('00000000-0000-4000-8000-000000000906', '1 minute');
select is((select count(*) from public.kiosk_devices), 0::bigint, 'owner B sees no kiosk of org A');
select throws_ok(
  $$select * from public.rpc_kiosk_create('20000000-0000-4000-8000-0000000009a1', 'Rogue')$$,
  '42501', 'not_authorized', 'owner B cannot create a kiosk on a site of org A'
);
select throws_ok(
  $$select * from public.rpc_kiosk_new_pairing_code(pg_temp.v('deviceA')::uuid)$$,
  '42501', 'not_authorized', 'owner B cannot issue codes for a kiosk of org A'
);
select throws_ok(
  $$select public.rpc_kiosk_revoke(pg_temp.v('deviceA')::uuid)$$,
  '42501', 'not_authorized', 'owner B cannot revoke a kiosk of org A'
);
insert into k
select 'deviceB', device_id::text from public.rpc_kiosk_create('20000000-0000-4000-8000-0000000009b1', 'Balie B');
insert into k
select 'codeB', pairing_code from public.rpc_kiosk_new_pairing_code(pg_temp.v('deviceB')::uuid);

-- PINs ---------------------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000904');
select throws_ok($$select public.rpc_set_my_pin('1234')$$, '22023', 'pin_too_simple', 'a trivial own PIN is refused');
select throws_ok($$select public.rpc_set_my_pin('12345678')$$, '22023', 'pin_invalid_format', 'a PIN longer than 6 digits is refused');
select is(public.rpc_set_my_pin('2580'), 1, 'an employee sets their own PIN without MFA');
select results_eq(
  $$select employee_id, set_by from public.employee_pins$$,
  $$values ('40000000-0000-4000-8000-000000000904'::uuid, '00000000-0000-4000-8000-000000000904'::uuid)$$,
  'the employee sees that their own PIN is set'
);
select throws_ok($$select pin_hash from public.employee_pins$$, '42501', null, 'pin_hash is not selectable');
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000908', '4826')$$,
  '42501', 'not_authorized', 'an employee cannot set another employee''s PIN'
);

select pg_temp.login('00000000-0000-4000-8000-000000000903');
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000908', '4826')$$,
  '42501', 'not_authorized', 'a manager without fresh MFA cannot set PINs'
);
select pg_temp.login('00000000-0000-4000-8000-000000000903', '1 minute');
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000908', '7777')$$,
  '22023', 'pin_too_simple', 'a manager cannot set a trivial PIN'
);
select lives_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000908', '4826')$$,
  'a manager sets the PIN of a kiosk-only employee on a managed site'
);
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000909', '4826')$$,
  '42501', 'not_authorized', 'a manager cannot set the PIN of another site''s employee'
);
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000901', '4826')$$,
  '42501', 'not_authorized', 'a manager cannot set the owner''s PIN'
);

select pg_temp.login('00000000-0000-4000-8000-000000000902', '1 minute');
select lives_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000909', '5173')$$,
  'an admin sets a PIN anywhere in the org'
);

select pg_temp.login('00000000-0000-4000-8000-000000000906', '1 minute');
select is((select count(*) from public.employee_pins), 0::bigint, 'owner B sees no PIN rows of org A');
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000908', '4826')$$,
  '42501', 'not_authorized', 'owner B cannot set a PIN in org A'
);

reset role;
select is(
  (select count(*) from public.audit_log
   where action = 'employee.kiosk_pin_set' and organization_id = '10000000-0000-4000-8000-00000000090a'),
  3::bigint, 'every PIN change is audited'
);
select ok(
  not exists (
    select 1 from public.audit_log as log, jsonb_each_text(log.metadata) as entry
    where log.organization_id in ('10000000-0000-4000-8000-00000000090a', '10000000-0000-4000-8000-00000000090b')
      and (entry.key ilike '%pin%' or entry.value in ('2580', '4826', '5173', '1234', '7777'))
  ),
  'no PIN ever reaches the audit metadata'
);
select ok(
  (select pin_hash like '$2a$10$%' and pin_hash <> '2580' from public.employee_pins
   where employee_id = '40000000-0000-4000-8000-000000000904'),
  'the PIN is stored as a bcrypt hash (cost 10)'
);

-- Roles and several employers.
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000903', '1 minute');
select throws_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000919', '4826')$$,
  '42501', 'not_authorized', 'a manager cannot set another manager''s PIN'
);
select pg_temp.login('00000000-0000-4000-8000-000000000902', '1 minute');
select lives_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000903', '4826')$$,
  'an admin sets a manager''s PIN'
);
select lives_ok(
  $$select public.rpc_set_employee_pin('40000000-0000-4000-8000-000000000902', '4826')$$,
  'an admin sets an admin''s PIN'
);
select pg_temp.login('00000000-0000-4000-8000-000000000908');
select is(public.rpc_set_my_pin('7391'), 2, 'an employee of two organizations sets their PIN in both');
reset role;
select results_eq(
  $$select organization_id, extensions.crypt('7391', pin_hash) = pin_hash from public.employee_pins
    where employee_id in ('40000000-0000-4000-8000-000000000918', '40000000-0000-4000-8000-000000000928')
    order by organization_id$$,
  $$values ('10000000-0000-4000-8000-00000000090a'::uuid, true), ('10000000-0000-4000-8000-00000000090b'::uuid, true)$$,
  'the same PIN now works for both employers'
);

-- Pairing (anon) -----------------------------------------------------------------------------

select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code, device_secret from public.rpc_kiosk_pair('ZZZZZZZZ')$$,
  $$values (false, 'code_invalid'::text, null::text)$$,
  'an unknown code is refused'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_pair(pg_temp.v('codeA'))$$,
  $$values (false, 'code_invalid'::text)$$,
  'a code replaced by a newer one no longer pairs'
);
insert into k
select 'secretA', device_secret
from public.rpc_kiosk_pair(lower(substr(pg_temp.v('codeA2'), 1, 4) || '-' || substr(pg_temp.v('codeA2'), 5)));
select ok(pg_temp.v('secretA') ~ '^[0-9a-f]{64}$', 'pairing returns a 256-bit secret (typed lowercase, with a dash)');
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_pair(pg_temp.v('codeA2'))$$,
  $$values (false, 'code_invalid'::text)$$,
  'a pairing code works only once'
);
insert into k
select 'secretB', device_secret from public.rpc_kiosk_pair(pg_temp.v('codeB'));

reset role;
select is(
  (select secret_hash from public.kiosk_devices where id = pg_temp.v('deviceA')::uuid),
  extensions.digest(decode(pg_temp.v('secretA'), 'hex'), 'sha256'),
  'only sha256(secret) is stored'
);
select results_eq(
  $$select actor_user_id, metadata ->> 'device_id' from public.audit_log where action = 'kiosk.paired' and entity_id = pg_temp.v('deviceA')::uuid$$,
  $$values (null::uuid, pg_temp.v('deviceA'))$$,
  'pairing is audited without an actor'
);

-- Expiry: an issued code that ran out.
select pg_temp.login('00000000-0000-4000-8000-000000000902', '1 minute');
set local role authenticated;
insert into k
select 'codeExpired', pairing_code from public.rpc_kiosk_new_pairing_code(pg_temp.v('deviceA')::uuid);
reset role;
update private.kiosk_pairing_codes set expires_at = clock_timestamp() - interval '1 second'
where device_id = pg_temp.v('deviceA')::uuid and used_at is null;
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_pair(pg_temp.v('codeExpired'))$$,
  $$values (false, 'code_invalid'::text)$$,
  'an expired code is refused'
);
reset role;
select is(
  (select count(*) from public.audit_log where action = 'kiosk.pairing_code_created' and entity_id = pg_temp.v('deviceA')::uuid),
  2::bigint, 'every new pairing code is audited'
);

-- Pairing pause: a safety valve at 5000 failures in 15 minutes, far above
-- what anyone needs, so a stranger cannot pause pairing for every customer.
select pg_temp.login('00000000-0000-4000-8000-000000000902', '1 minute');
set local role authenticated;
insert into k
select 'codeValid', pairing_code from public.rpc_kiosk_new_pairing_code(pg_temp.v('deviceA')::uuid);
reset role;
delete from private.kiosk_attempts where kind = 'pair_failure';
insert into private.kiosk_attempts (kind) select 'pair_failure' from generate_series(1, 60);
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_pair('WRNGWRNG')$$,
  $$values (false, 'code_invalid'::text)$$,
  '60 failures no longer pause pairing'
);
reset role;
insert into private.kiosk_attempts (kind) select 'pair_failure' from generate_series(1, 4999 - 61);
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_pair('WRNGWRNG')$$,
  $$values (false, 'code_invalid'::text)$$,
  'the 5000th failure is still an ordinary refusal'
);
select results_eq(
  $$select ok, error_code, device_secret from public.rpc_kiosk_pair(pg_temp.v('codeValid'))$$,
  $$values (false, 'pairing_paused'::text, null::text)$$,
  'after 5000 failures even a valid code is paused'
);
select throws_ok(
  $$select * from public.rpc_kiosk_pairing_failures()$$,
  '42501', null, 'anon cannot read the pairing failure counter'
);
reset role;
set local role service_role;
select results_eq(
  $$select failures, paused from public.rpc_kiosk_pairing_failures()$$,
  $$values (5000, true)$$,
  'operators see the failure count and the pause (no audit rows)'
);
reset role;
select is(
  (select count(*) from private.kiosk_attempts where kind = 'pair_failure'),
  5000::bigint, 'blocked pairing calls are not recorded'
);
delete from private.kiosk_attempts where kind = 'pair_failure';
select ok(
  (select used_at is null from private.kiosk_pairing_codes
   where code_hash = extensions.digest(pg_temp.v('codeValid'), 'sha256')),
  'a paused pairing does not spend the code'
);

-- Roster (anon) ------------------------------------------------------------------------------

select pg_temp.as_anon();
select throws_ok($$select * from public.rpc_kiosk_roster(null)$$, '42501', 'device_unknown', 'no secret: no roster');
select throws_ok($$select * from public.rpc_kiosk_roster('not-a-secret')$$, '42501', 'device_unknown', 'a malformed secret: no roster');
select throws_ok(
  $$select * from public.rpc_kiosk_roster(repeat('ab', 32))$$,
  '42501', 'device_unknown', 'an unknown secret: no roster'
);
select results_eq(
  $$select employee_id, display_name, initials, has_pin from public.rpc_kiosk_roster(pg_temp.v('secretA'))$$,
  $$values
    ('40000000-0000-4000-8000-000000000904'::uuid, 'Emma van Dijk'::text, 'EV'::text, true),
    ('40000000-0000-4000-8000-000000000908'::uuid, 'Karel Kiosk'::text, 'KK'::text, true),
    ('40000000-0000-4000-8000-000000000919'::uuid, 'Mira Manager'::text, 'MM'::text, false),
    ('40000000-0000-4000-8000-000000000901'::uuid, 'Olga Owner'::text, 'OO'::text, false)$$,
  'the roster lists the active, not suspended employees of the kiosk''s site only'
);
reset role;
select ok(
  (select last_seen_at > now() - interval '1 minute' from public.kiosk_devices where id = pg_temp.v('deviceA')::uuid),
  'the roster call updates last_seen_at'
);

-- Status and clocking (anon) -----------------------------------------------------------------

select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code, state from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826')$$,
  $$values (true, null::text, 'off'::text)$$,
  'status with the right PIN: off'
);
select results_eq(
  $$select ok, error_code, state, occurred_at is not null
    from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826', 'clock_in', '50000000-0000-4000-8000-000000000901')$$,
  $$values (true, null::text, 'working'::text, true)$$,
  'a kiosk-only employee clocks in with their PIN'
);
select results_eq(
  $$select ok, state from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826', 'clock_in', '50000000-0000-4000-8000-000000000901')$$,
  $$values (true, 'working'::text)$$,
  'a replay with the same key returns the original event'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826', 'clock_in', gen_random_uuid())$$,
  $$values (false, 'invalid_transition'::text)$$,
  'the live transition rules apply at the kiosk'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826', 'void', gen_random_uuid())$$,
  $$values (false, 'invalid_input'::text)$$,
  'a kiosk cannot append a void'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826', 'clock_out', '50000000-0000-4000-8000-000000000901')$$,
  $$values (false, 'invalid_input'::text)$$,
  'a reused idempotency key with another action is refused as invalid input'
);

reset role;
select results_eq(
  $$select source, device_id, actor_user_id, site_id, occurred_at = server_at
    from public.clock_events where employee_id = '40000000-0000-4000-8000-000000000908'$$,
  $$values ('kiosk'::text, pg_temp.v('deviceA')::uuid, null::uuid, '20000000-0000-4000-8000-0000000009a1'::uuid, true)$$,
  'one kiosk event: source kiosk, the device, no actor, the device''s site, server time'
);
select results_eq(
  $$select log.actor_user_id, log.metadata
    from public.audit_log as log
    join public.clock_events as event on event.id = log.entity_id
    where log.action = 'clock_event.recorded' and event.employee_id = '40000000-0000-4000-8000-000000000908'$$,
  $$values (null::uuid, jsonb_build_object(
    'employee_id', '40000000-0000-4000-8000-000000000908', 'site_id', '20000000-0000-4000-8000-0000000009a1',
    'type', 'clock_in', 'source', 'kiosk', 'device_id', pg_temp.v('deviceA')))$$,
  'the kiosk event is audited without an actor and with metadata.device_id'
);

-- A signed-in browser on the tablet changes nothing: still no actor.
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000903', '1 minute');
select results_eq(
  $$select ok, state from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '2580', 'clock_in', '50000000-0000-4000-8000-000000000902')$$,
  $$values (true, 'working'::text)$$,
  'kiosk clocking works from a signed-in browser too'
);
reset role;
select results_eq(
  $$select event.actor_user_id, log.actor_user_id
    from public.clock_events as event
    join public.audit_log as log on log.entity_id = event.id and log.action = 'clock_event.recorded'
    where event.idempotency_key = '50000000-0000-4000-8000-000000000902'$$,
  $$values (null::uuid, null::uuid)$$,
  'a JWT on the kiosk call never becomes the actor'
);

-- Refusals: uniform to the caller, specific in the audit trail.
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000909', '5173')$$,
  $$values (false, 'pin_invalid'::text, 4)$$,
  'an employee of another site is refused, even with their right PIN'
);
select results_eq(
  $$select ok, error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000999', '5173')$$,
  $$values (false, 'pin_invalid'::text, 4)$$,
  'an unknown employee looks exactly the same'
);
select results_eq(
  $$select ok, error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000907', '5173')$$,
  $$values (false, 'pin_invalid'::text, 4)$$,
  'a suspended employee looks exactly the same'
);
select results_eq(
  $$select ok, error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000901', '5173')$$,
  $$values (false, 'pin_invalid'::text, 4)$$,
  'an employee without a PIN looks exactly the same'
);
select results_eq(
  $$select ok, error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '9999')$$,
  $$values (false, 'pin_invalid'::text, 4)$$,
  'a wrong PIN: 4 tries left'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_status(repeat('ab', 32), '40000000-0000-4000-8000-000000000904', '2580')$$,
  $$values (false, 'device_unknown'::text)$$,
  'a right PIN without a valid device secret is refused'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(null, '40000000-0000-4000-8000-000000000904', '2580', 'clock_out', gen_random_uuid())$$,
  $$values (false, 'device_unknown'::text)$$,
  'anon without a secret cannot clock'
);
reset role;
select results_eq(
  $$select metadata ->> 'reason', metadata ? 'employee_id', actor_user_id
    from public.audit_log
    where action = 'kiosk.pin_failed' and entity_id = pg_temp.v('deviceA')::uuid
    order by created_at$$,
  $$values ('not_eligible'::text, true, null::uuid), ('not_eligible', false, null), ('not_eligible', true, null),
    ('no_pin', true, null), ('wrong_pin', true, null)$$,
  'every PIN failure is audited with its reason; foreign ids stay out'
);
select ok(
  not exists (
    select 1 from public.audit_log as log, jsonb_each_text(log.metadata) as entry
    where log.organization_id in ('10000000-0000-4000-8000-00000000090a', '10000000-0000-4000-8000-00000000090b')
      and (entry.key ilike '%pin%' or entry.value in ('9999', '5173', '2580', '4826'))
  ),
  'a typed PIN never reaches the audit metadata'
);
select is(
  (select count(*) from private.kiosk_attempts
   where created_at >= now() and (device_id is null or device_id <> pg_temp.v('deviceA')::uuid)),
  0::bigint, 'calls without a valid device record nothing'
);

-- Lockout: 5 wrong PINs per employee per device in 15 minutes.
select pg_temp.as_anon();
select results_eq(
  $$select error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '1111')$$,
  $$values ('pin_invalid'::text, 3)$$, 'second wrong PIN: 3 tries left'
);
select results_eq(
  $$select error_code, tries_left from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '1112', 'clock_out', gen_random_uuid())$$,
  $$values ('pin_invalid'::text, 2)$$, 'wrong PINs count on the clock call too'
);
select results_eq(
  $$select error_code, tries_left from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '1113')$$,
  $$values ('pin_invalid'::text, 1)$$, 'fourth wrong PIN: 1 try left'
);
select results_eq(
  $$select error_code, retry_after from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '1114')$$,
  $$values ('pin_locked'::text, 900)$$, 'the fifth wrong PIN locks the employee for 15 minutes'
);
reset role;
insert into k select 'auditBeforeLocked', count(*)::text from public.audit_log
where organization_id = '10000000-0000-4000-8000-00000000090a';
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '2580', 'clock_out', gen_random_uuid())$$,
  $$values (false, 'pin_locked'::text)$$, 'while locked, even the right PIN is refused'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '1115')$$,
  $$values (false, 'pin_locked'::text)$$, 'while locked, a wrong PIN answers the same'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '2580')$$,
  $$values (false, 'pin_locked'::text)$$, 'and again'
);
reset role;
select is(
  (select count(*) from public.audit_log where organization_id = '10000000-0000-4000-8000-00000000090a'),
  pg_temp.v('auditBeforeLocked')::bigint,
  'calls during a lockout write no audit rows'
);
select pg_temp.as_anon();
select results_eq(
  $$select ok, state from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '4826')$$,
  $$values (true, 'working'::text)$$, 'another employee on the same kiosk is unaffected'
);
reset role;
select is(
  (select count(*) from private.kiosk_attempts where employee_id = '40000000-0000-4000-8000-000000000904'),
  5::bigint, 'blocked PIN checks are not recorded'
);
select is(
  (select count(*) from public.audit_log
   where action = 'kiosk.pin_refused' and organization_id = '10000000-0000-4000-8000-00000000090a'),
  0::bigint, 'a lockout is silent: no refusal rows'
);

-- The employee's own phone login is unaffected, and a new PIN lifts the lock.
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000904');
select results_eq(
  $$select type, source, actor_user_id, device_id
    from public.rpc_clock('clock_out', '50000000-0000-4000-8000-000000000903', '20000000-0000-4000-8000-0000000009a1')$$,
  $$values ('clock_out'::text, 'app'::text, '00000000-0000-4000-8000-000000000904'::uuid, null::uuid)$$,
  'rpc_clock unchanged: the caller is the actor, source app, no device'
);
reset role;
select results_eq(
  $$select log.actor_user_id, log.metadata from public.audit_log as log
    join public.clock_events as event on event.id = log.entity_id
    where event.idempotency_key = '50000000-0000-4000-8000-000000000903'$$,
  $$values ('00000000-0000-4000-8000-000000000904'::uuid, jsonb_build_object(
    'employee_id', '40000000-0000-4000-8000-000000000904', 'site_id', '20000000-0000-4000-8000-0000000009a1',
    'type', 'clock_out', 'source', 'app'))$$,
  'rpc_clock unchanged: the same audit metadata as before'
);
set local role authenticated;
select throws_ok(
  $$select public.rpc_clock('clock_out', gen_random_uuid(), '20000000-0000-4000-8000-0000000009a1')$$,
  'P0001', 'invalid_transition', 'rpc_clock unchanged: a transition from the kiosk state is still validated'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000009a2')$$,
  '42501', 'site_not_assigned', 'rpc_clock unchanged: unassigned sites are refused'
);
select is(public.rpc_set_my_pin('3690'), 1, 'setting a new PIN');
select pg_temp.as_anon();
select results_eq(
  $$select ok, state from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '3690')$$,
  $$values (true, 'off'::text)$$, 'a new PIN lifts the lockout'
);

-- Device pause: 30 failures per device in 15 minutes.
reset role;
insert into private.kiosk_attempts (kind, device_id, employee_id)
select 'pin_failure', pg_temp.v('deviceA')::uuid, gen_random_uuid()
from generate_series(1, 30 - (select count(*)::integer from private.kiosk_attempts where device_id = pg_temp.v('deviceA')::uuid) - 1);
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code, retry_after from public.rpc_kiosk_status(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000908', '0852')$$,
  $$values (false, 'device_paused'::text, 900)$$,
  'the 30th failure on a device pauses it'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretA'), '40000000-0000-4000-8000-000000000904', '3690', 'clock_in', gen_random_uuid())$$,
  $$values (false, 'device_paused'::text)$$,
  'a paused device refuses even the right PIN'
);
select throws_ok(
  $$select * from public.rpc_kiosk_roster(pg_temp.v('secretA'))$$,
  'P0001', 'device_paused', 'a paused device shows no roster'
);
reset role;
select ok(
  (select paused_until between now() + interval '14 minutes' and clock_timestamp() + interval '15 minutes'
   from public.kiosk_devices where id = pg_temp.v('deviceA')::uuid),
  'the device is paused for 15 minutes'
);
select is(
  (select count(*) from public.audit_log where action = 'kiosk.device_paused' and entity_id = pg_temp.v('deviceA')::uuid),
  1::bigint, 'the pause is audited once'
);
update public.kiosk_devices set paused_until = null where id = pg_temp.v('deviceA')::uuid;
delete from private.kiosk_attempts;

-- Cross-tenant: org B's kiosk cannot clock org A's employees.
select pg_temp.as_anon();
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretB'), '40000000-0000-4000-8000-000000000904', '3690', 'clock_in', gen_random_uuid())$$,
  $$values (false, 'pin_invalid'::text)$$,
  'a kiosk of org B cannot clock an employee of org A'
);
select is(
  (select count(*) from public.rpc_kiosk_roster(pg_temp.v('secretB'))
   where employee_id = '40000000-0000-4000-8000-000000000904'),
  0::bigint, 'org B''s roster never lists org A''s employees'
);
reset role;
select ok(
  not exists (
    select 1 from public.audit_log
    where organization_id = '10000000-0000-4000-8000-00000000090b'
      and metadata::text like '%40000000-0000-4000-8000-000000000904%'
  ),
  'org B''s audit trail never names org A''s employee'
);

-- Re-pairing replaces the secret; revocation ends it.
select pg_temp.as_anon();
insert into k
select 'secretA2', device_secret from public.rpc_kiosk_pair(pg_temp.v('codeValid'));
select throws_ok(
  $$select * from public.rpc_kiosk_roster(pg_temp.v('secretA'))$$,
  '42501', 'device_unknown', 'after re-pairing, the old tablet''s secret stops working'
);
select is(
  (select count(*) from public.rpc_kiosk_roster(pg_temp.v('secretA2'))),
  4::bigint, 'the newly paired tablet works'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000901', '1 minute');
select lives_ok($$select public.rpc_kiosk_revoke(pg_temp.v('deviceA')::uuid)$$, 'the owner revokes the kiosk');
select lives_ok($$select public.rpc_kiosk_revoke(pg_temp.v('deviceA')::uuid)$$, 'revoking twice is harmless');
select results_eq(
  $$select status from public.kiosk_devices where id = pg_temp.v('deviceA')::uuid$$,
  $$values ('revoked'::text)$$, 'the kiosk is listed as revoked'
);
select throws_ok(
  $$select * from public.rpc_kiosk_new_pairing_code(pg_temp.v('deviceA')::uuid)$$,
  '22023', 'device_revoked', 'a revoked kiosk gets no new pairing code'
);
select pg_temp.as_anon();
select throws_ok(
  $$select * from public.rpc_kiosk_roster(pg_temp.v('secretA2'))$$,
  '42501', 'device_unknown', 'a revoked kiosk shows no roster'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(pg_temp.v('secretA2'), '40000000-0000-4000-8000-000000000904', '3690', 'clock_in', gen_random_uuid())$$,
  $$values (false, 'device_unknown'::text)$$,
  'a revoked kiosk cannot clock'
);
reset role;
select is(
  (select secret_hash from public.kiosk_devices where id = pg_temp.v('deviceA')::uuid),
  null::bytea, 'revocation forgets the secret hash'
);
select is(
  (select count(*) from public.audit_log where action = 'kiosk.revoked' and entity_id = pg_temp.v('deviceA')::uuid),
  1::bigint, 'revocation is audited once'
);

-- Integrity --------------------------------------------------------------------------------

select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000090a'), null::uuid, 'kiosk events verify in the clock chain');
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000090a'), null::uuid, 'kiosk audit rows verify in the audit chain');
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000090b'), null::uuid, 'org B''s audit chain verifies');

select * from finish();
rollback;
