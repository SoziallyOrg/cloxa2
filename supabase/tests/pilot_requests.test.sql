begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(42);

create function pg_temp.h(p_label text)
returns bytea
language sql
immutable
as $$
  select extensions.digest(p_label, 'sha256');
$$;
grant execute on function pg_temp.h(text) to service_role, anon, authenticated;

-- One submission (BE0403019261 is a valid number); returns whether it was stored.
create function pg_temp.submit(
  p_email text,
  p_ip text,
  p_vat text default 'BE0403019261',
  p_sector text default 'horeca',
  p_consent boolean default true,
  p_message text default null
)
returns boolean
language sql
as $$
  select public.rpc_submit_pilot_request(
    'Bakkerij Test', p_vat, 'Jo Test', p_email, '  ', '10-49', p_sector, p_message, p_consent,
    pg_temp.h('e:' || p_email), case when p_ip is null then null else pg_temp.h('ip:' || p_ip) end
  );
$$;
grant execute on function pg_temp.submit(text, text, text, text, boolean, text) to service_role, anon, authenticated;

-- The VAT check ---------------------------------------------------------------------------

select ok(private.is_valid_be_vat('BE0403019261'), 'a real Belgian number passes the mod-97 check');
select ok(private.is_valid_be_vat('BE0403019261') and private.is_valid_be_vat('BE0123456749'), 'a second valid number');
select ok(
  not private.is_valid_be_vat('BE0403019262')
    and not private.is_valid_be_vat('BE040301926')
    and not private.is_valid_be_vat('NL0403019261')
    and not private.is_valid_be_vat('BE0403 019261')
    and not private.is_valid_be_vat('BE2403019261'),
  'a wrong check digit, a wrong length, country or leading digit fail'
);
select ok(not coalesce(private.is_valid_be_vat(null), false), 'null is not a valid number');

-- Nobody reads the table -------------------------------------------------------------------

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'private.pilot_requests'::regclass),
  'RLS is enabled on pilot_requests'
);
select ok(
  not pg_catalog.has_table_privilege('anon', 'private.pilot_requests', 'SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('authenticated', 'private.pilot_requests', 'SELECT,INSERT,UPDATE,DELETE')
    and not pg_catalog.has_table_privilege('service_role', 'private.pilot_requests', 'SELECT,INSERT,UPDATE,DELETE'),
  'no API role has any privilege on pilot_requests'
);
select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.proname in (
      'rpc_submit_pilot_request', 'rpc_admin_list_pilot_requests',
      'rpc_admin_activate_pilot_request', 'rpc_admin_reject_pilot_request'
    ) and (
      pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
      or pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
      or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
    )
  ),
  '{}'::text[],
  'the pilot request RPCs are executable by service_role only'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('submit_pilot_request', 'activate_pilot_request', 'purge_pilot_requests', 'is_valid_be_vat')
      and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ),
  'the private pilot request functions are not executable by API roles'
);

-- Fixtures: an organization with an owner, to prove a tenant sees none of it.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-000000000a01', 'pilot-tenant-owner@example.test'),
  ('00000000-0000-4000-8000-000000000a02', 'pilot-new-owner@example.test'),
  ('00000000-0000-4000-8000-000000000a03', 'pilot-second-owner@example.test');
insert into public.organizations (id, name) values ('10000000-0000-4000-8000-000000000a0a', 'Pilot tenant');
insert into public.memberships (organization_id, user_id, role, status)
values ('10000000-0000-4000-8000-000000000a0a', '00000000-0000-4000-8000-000000000a01', 'owner', 'active');

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select pg_temp.submit('anon@example.test', '192.0.2.1')$$,
  '42501', null, 'anon cannot submit directly with the public key'
);
select throws_ok($$select * from private.pilot_requests$$, '42501', null, 'anon cannot read the requests');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000a01"}';
select throws_ok(
  $$select pg_temp.submit('member@example.test', '192.0.2.2')$$,
  '42501', null, 'a signed-in user cannot submit directly either'
);
select throws_ok(
  $$select * from private.pilot_requests$$,
  '42501', null, 'the owner of another organization cannot read the requests'
);
select throws_ok(
  $$select * from public.rpc_admin_list_pilot_requests()$$,
  '42501', null, 'nor list them through the operator RPC'
);
reset role;

-- Storing -------------------------------------------------------------------------------------

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

select is(pg_temp.submit('  Jo@Example.TEST ', '203.0.113.1'), true, 'a valid request is stored');
reset role;
select results_eq(
  $$select email, phone, status, vat_number, message from private.pilot_requests where email = 'jo@example.test'$$,
  $$values ('jo@example.test'::text, null::text, 'open'::text, 'BE0403019261'::text, null::text)$$,
  'the email is normalised, a blank phone becomes null, the request starts open'
);

set local role service_role;
select throws_ok(
  $$select pg_temp.submit('x1@example.test', '203.0.113.2', p_consent => false)$$,
  '22023', 'invalid_input', 'no consent, no request'
);
select throws_ok(
  $$select pg_temp.submit('x2@example.test', '203.0.113.2', p_vat => 'BE0403019262')$$,
  '22023', 'invalid_input', 'a wrong VAT number is refused by the database too'
);
select throws_ok(
  $$select pg_temp.submit('x3@example.test', '203.0.113.2', p_sector => 'piraten')$$,
  '22023', 'invalid_input', 'an unknown sector is refused'
);
select throws_ok(
  $$select pg_temp.submit('x4@example.test', '203.0.113.2', p_message => repeat('a', 1001))$$,
  '22023', 'invalid_input', 'a message over 1000 characters is refused'
);
select throws_ok(
  $$select pg_temp.submit('geen-email', '203.0.113.2')$$,
  '22023', 'invalid_input', 'an address without an @ is refused'
);
reset role;
select is(
  (select count(*) from private.pilot_requests where email like 'x_@example.test' or email = 'geen-email'),
  0::bigint, 'refused requests leave nothing behind'
);

-- Limits: 3 per email per day, 10 per IP per day ----------------------------------------------

set local role service_role;
select results_eq(
  $$select pg_temp.submit('same@example.test', '198.51.100.' || n) from generate_series(1, 5) as n order by n$$,
  $$values (true), (true), (true), (false), (false)$$,
  'an address gets three requests per day, from any IP'
);
select results_eq(
  $$select pg_temp.submit('ip' || n || '@example.test', '198.51.100.99') from generate_series(1, 12) as n order by n$$,
  $$values (true), (true), (true), (true), (true), (true), (true), (true), (true), (true), (false), (false)$$,
  'an IP gets ten requests per day, for any address'
);
select is(
  pg_temp.submit('other@example.test', '198.51.100.98'),
  true, 'other addresses on other IPs are unaffected'
);
select results_eq(
  $$select pg_temp.submit('nip' || n || '@example.test', null) from generate_series(1, 12) as n order by n$$,
  $$values (true), (true), (true), (true), (true), (true), (true), (true), (true), (true), (true), (true)$$,
  'an unknown IP skips the IP rule instead of sharing one bucket'
);
reset role;
select is(
  (select count(*) from private.pilot_requests where email = 'same@example.test'),
  3::bigint, 'a limited request is not stored'
);
select is(
  (select count(*) from private.auth_attempts where kind = 'pilot_request_email' and key_hash = pg_temp.h('e:same@example.test')),
  3::bigint, 'and not counted, so the block ends on time'
);

-- Operator: list, activate, reject --------------------------------------------------------------

set local role service_role;
select is(
  (select count(*) from public.rpc_admin_list_pilot_requests() where email = 'jo@example.test'),
  1::bigint, 'the operator lists open requests'
);

reset role;
select id as jo_id from private.pilot_requests where email = 'jo@example.test' \gset
select id as same_id from private.pilot_requests where email = 'same@example.test' order by created_at limit 1 \gset

set local role service_role;
select is(
  (select count(*) from public.rpc_admin_activate_pilot_request(:'jo_id', '00000000-0000-4000-8000-000000000a02', 'Winkel Centrum')),
  1::bigint, 'activating creates the organization, its first site and the owner'
);
reset role;
select is(
  (select s.name from private.pilot_requests as r join public.sites as s on s.organization_id = r.organization_id where r.id = :'jo_id'),
  'Winkel Centrum', 'the first site carries the chosen name'
);
select results_eq(
  format($$select r.status, o.name, m.role, m.status
    from private.pilot_requests as r
    join public.organizations as o on o.id = r.organization_id
    join public.memberships as m on m.organization_id = o.id
    where r.id = %L$$, :'jo_id'),
  $$values ('activated'::text, 'Bakkerij Test'::text, 'owner'::text, 'active'::text)$$,
  'the request is activated and linked; the contact is an active owner'
);
select is(
  (select count(*) from public.audit_log where action = 'organization.created'
    and organization_id = (select organization_id from private.pilot_requests where id = :'jo_id')),
  1::bigint, 'activation is audited'
);

set local role service_role;
select throws_ok(
  format($$select * from public.rpc_admin_activate_pilot_request(%L, '00000000-0000-4000-8000-000000000a03')$$, :'jo_id'),
  'P0001', 'request_not_open', 'a request is activated only once'
);
select throws_ok(
  $$select * from public.rpc_admin_activate_pilot_request('00000000-0000-4000-8000-0000000000ff', '00000000-0000-4000-8000-000000000a03')$$,
  '22023', 'request_not_found', 'an unknown request id is refused'
);
select is(
  (select count(*) from public.rpc_admin_list_pilot_requests() where email = 'jo@example.test'),
  0::bigint, 'an activated request leaves the open list'
);
select is(
  (select count(*) from public.rpc_admin_list_pilot_requests(:'jo_id')),
  1::bigint, 'but can still be looked up by id'
);
select is(public.rpc_admin_reject_pilot_request(:'same_id'), true, 'an open request can be rejected');
select is(public.rpc_admin_reject_pilot_request(:'same_id'), false, 'not twice');
select is(public.rpc_admin_reject_pilot_request(:'jo_id'), false, 'and an activated one is not rejected afterwards');
reset role;

-- Retention: 12 months --------------------------------------------------------------------------

insert into private.pilot_requests (created_at, company_name, vat_number, contact_name, email, employee_range, sector)
values
  (now() - interval '13 months', 'Oud', 'BE0403019261', 'Oud', 'old@example.test', '1-9', 'andere'),
  (now() - interval '11 months', 'Bijna oud', 'BE0403019261', 'Oud', 'almost@example.test', '1-9', 'andere');

create temporary table run (result jsonb) on commit drop;
insert into run select private.run_retention();
select is(
  (select (result ->> 'pilot_requests_purged')::integer from run),
  1, 'retention deletes the one request older than 12 months'
);
select results_eq(
  $$select email from private.pilot_requests where email in ('old@example.test', 'almost@example.test')$$,
  $$values ('almost@example.test'::text)$$,
  'and keeps the one from 11 months ago'
);
select is(
  (select count(*) from public.organizations where name = 'Bakkerij Test'),
  1::bigint, 'the organization created from a purged request would stay (only the request record goes)'
);

select * from finish();
rollback;
