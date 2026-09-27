begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
-- auth.uid() prefers this legacy setting; blank it so request.jwt.claims wins.
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

select plan(74);

-- Fixtures (rolled back). Org A: owner u1 (A1 and A2), admin u2, manager u3
-- (manages site A1), employees u4 (A1), u5 (A2), suspended u7 (A1),
-- kiosk-only e8 (A2). Org B: owner u6. u9 has no membership at all.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000000' || n)::uuid, 'tenancy-u' || n || '@example.test'
from generate_series(1, 9) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000000a', 'Org A'),
  ('10000000-0000-4000-8000-00000000000b', 'Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000000a1', '10000000-0000-4000-8000-00000000000a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000000a2', '10000000-0000-4000-8000-00000000000a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000000b1', '10000000-0000-4000-8000-00000000000b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'owner', 'active'),
  ('30000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000002', 'admin', 'active'),
  ('30000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000003', 'manager', 'active'),
  ('30000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000004', 'employee', 'active'),
  ('30000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000005', 'employee', 'active'),
  ('30000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000006', 'owner', 'active'),
  ('30000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000007', 'employee', 'suspended');

insert into public.employees (id, organization_id, user_id, display_name) values
  ('40000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000001', 'Owner A'),
  ('40000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000003', 'Manager A'),
  ('40000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000004', 'Employee A1'),
  ('40000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000005', 'Employee A2'),
  ('40000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000006', 'Owner B'),
  ('40000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000007', 'Suspended A1'),
  ('40000000-0000-4000-8000-000000000008', '10000000-0000-4000-8000-00000000000a', null, 'Kiosk-only A2');

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000001', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-000000000001', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000003', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000004', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-000000000005', null),
  ('10000000-0000-4000-8000-00000000000b', '20000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-000000000006', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000007', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a2', '40000000-0000-4000-8000-000000000008', null),
  ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', null, '30000000-0000-4000-8000-000000000003');

-- Schema-wide guarantees ------------------------------------------------------

select is(
  array(
    select c.relname::text from pg_catalog.pg_class as c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace)
      and c.relkind = 'r' and not c.relrowsecurity
  ),
  '{}'::text[],
  'RLS is enabled on every table in public and private'
);

select is(
  array(
    select c.relname::text from pg_catalog.pg_class as c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and c.relkind = 'r'
      and pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ),
  '{}'::text[],
  'anon has no privilege on any table'
);

select is(
  array(
    select c.relname::text from pg_catalog.pg_class as c
    where c.relnamespace in ('public'::regnamespace, 'private'::regnamespace) and c.relkind = 'r'
      and pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ),
  '{}'::text[],
  'authenticated cannot write to any table'
);

select is(
  array(
    select c.relname::text from pg_catalog.pg_class as c
    where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
      and pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT')
    order by 1
  ),
  array[
    'audit_log', 'clock_events', 'correction_requests', 'employees', 'invitations', 'memberships',
    'organizations', 'schedules', 'site_assignments', 'sites'
  ],
  'authenticated may SELECT every public table (RLS decides rows)'
);

select ok(
  not pg_catalog.has_table_privilege('authenticated', 'private.hash_chain_heads', 'SELECT'),
  'chain heads are not readable by authenticated'
);

select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
    order by 1
  ),
  array[
    'private.can_see_employee(uuid)',
    'private.current_membership(uuid)',
    'private.is_privileged(uuid)',
    'rpc_accept_membership()',
    'rpc_clock(text,uuid,uuid,timestamp with time zone)',
    'rpc_decide_correction(uuid,text,text)',
    'rpc_invite_member(uuid,text,text,text,uuid[],text,text,text)',
    'rpc_my_status()',
    'rpc_request_correction(text,uuid[],jsonb,text)',
    'rpc_revoke_invitation(uuid)',
    'rpc_schedule_for(uuid,date,date)',
    'rpc_set_schedule(uuid,date,jsonb)',
    'rpc_sign_out_everywhere(uuid)',
    'rpc_verify_chains(uuid)',
    'rpc_withdraw_correction(uuid)'
  ],
  'authenticated executes only the RLS helpers and the public RPC wrappers'
);

select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  '{}'::text[],
  'anon executes nothing'
);

select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace)
      and not ('search_path=""' = any (coalesce(p.proconfig, '{}')))
  ),
  '{}'::text[],
  'every function pins search_path to empty'
);

select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.oid in (
      'private.current_membership(uuid)'::regprocedure,
      'private.is_privileged(uuid)'::regprocedure,
      'private.require_privileged(uuid)'::regprocedure,
      'private.can_see_employee(uuid)'::regprocedure,
      'private.has_fresh_mfa()'::regprocedure
    ) and p.provolatile <> 's'
  ),
  '{}'::text[],
  'access helpers are STABLE'
);

select throws_ok(
  $$insert into public.site_assignments (organization_id, site_id, employee_id)
    values ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000b1', '40000000-0000-4000-8000-000000000004')$$,
  '23503', null, 'composite FK rejects a cross-tenant site reference'
);

select throws_ok(
  $$insert into public.employees (organization_id, user_id, display_name)
    values ('10000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-000000000004', 'x')$$,
  '23503', null, 'an employee login must be a member of the same org'
);

select throws_ok(
  $$update public.organizations set settings = '{"location_capture":"off","retention_years":4}'
    where id = '10000000-0000-4000-8000-00000000000a'$$,
  '23514', null, 'retention below five years is rejected'
);

select throws_ok(
  $$delete from public.memberships where id = '30000000-0000-4000-8000-000000000004'$$,
  '23503', null, 'a membership with an employee row cannot be deleted (deactivate by status instead)'
);

-- Anonymous -------------------------------------------------------------------

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok('select 1 from public.organizations', '42501', null, 'anon cannot read organizations');
select throws_ok('select 1 from public.employees', '42501', null, 'anon cannot read employees');
reset role;

-- Employee u4 (aal1): self only -------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000004');

select results_eq('select id from public.organizations', $$values ('10000000-0000-4000-8000-00000000000a'::uuid)$$, 'employee sees only own org');
select is((select count(*) from public.sites), 2::bigint, 'employee sees the sites of own org only');
select results_eq('select id from public.memberships', $$values ('30000000-0000-4000-8000-000000000004'::uuid)$$, 'employee sees only own membership');
select results_eq('select id from public.employees', $$values ('40000000-0000-4000-8000-000000000004'::uuid)$$, 'employee sees only own employee row');
select results_eq('select site_id from public.site_assignments', $$values ('20000000-0000-4000-8000-0000000000a1'::uuid)$$, 'employee sees only own site assignment');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'employee is not privileged');

-- Metadata never grants anything.
select pg_temp.login('00000000-0000-4000-8000-000000000004', '1 minute', '{"app_metadata":{"role":"owner"},"user_metadata":{"role":"owner"}}');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'JWT metadata cannot promote an employee');
select results_eq('select id from public.employees', $$values ('40000000-0000-4000-8000-000000000004'::uuid)$$, 'employee with aal2 still sees only self');

select throws_ok(
  $$insert into public.employees (organization_id, display_name) values ('10000000-0000-4000-8000-00000000000a', 'x')$$,
  '42501', null, 'employee cannot insert employees'
);
select throws_ok(
  $$update public.memberships set role = 'owner' where user_id = '00000000-0000-4000-8000-000000000004'$$,
  '42501', null, 'employee cannot promote own membership'
);

-- Manager u3 ------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000003');
select results_eq('select id from public.employees', $$values ('40000000-0000-4000-8000-000000000003'::uuid)$$, 'manager without aal2 sees only self');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'manager without aal2 is not privileged');

select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), true, 'manager with aal2 is privileged');
select results_eq(
  'select id from public.employees order by id',
  $$values ('40000000-0000-4000-8000-000000000001'::uuid), ('40000000-0000-4000-8000-000000000003'::uuid),
    ('40000000-0000-4000-8000-000000000004'::uuid), ('40000000-0000-4000-8000-000000000007'::uuid)$$,
  'manager with aal2 sees exactly the employees of the managed site'
);
select results_eq('select id from public.memberships', $$values ('30000000-0000-4000-8000-000000000003'::uuid)$$, 'manager sees only own membership');
select is(
  (select count(*) from public.site_assignments where membership_id = '30000000-0000-4000-8000-000000000003'),
  1::bigint, 'manager sees own managed-site assignment'
);
select is(
  (select count(*) from public.site_assignments where employee_id = '40000000-0000-4000-8000-000000000005'),
  0::bigint, 'manager does not see assignments of employees only on an unmanaged site'
);
-- Deliberate: a visible employee's assignment rows are visible in full, so a
-- manager learns that the employee also works at a site they don't manage
-- (site id only; that site's other employees and events stay hidden).
select results_eq(
  $$select site_id from public.site_assignments where employee_id = '40000000-0000-4000-8000-000000000001' order by site_id$$,
  $$values ('20000000-0000-4000-8000-0000000000a1'::uuid), ('20000000-0000-4000-8000-0000000000a2'::uuid)$$,
  'manager sees a managed employee''s assignment at an unmanaged site'
);

-- Fresh-MFA rule (private.has_fresh_mfa) ------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000003', '11 hours 50 minutes');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), true, 'TOTP verified just under 12h ago is fresh');
select pg_temp.login('00000000-0000-4000-8000-000000000003', '13 hours');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'TOTP verified 13h ago is stale: not privileged');
select is((select count(*) from public.employees), 1::bigint, 'stale MFA falls back to self-only visibility');
select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute', '{"aal": null}');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'fresh amr without an aal claim is denied');
select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute', '{"amr": null}');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'aal2 with the amr claim removed is denied');
set local "request.jwt.claims" = '{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}';
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'aal2 without any amr claim is denied');
select is((select count(*) from public.employees), 1::bigint, 'aal2 without amr sees only self');
select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute', '{"amr": "totp"}');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'malformed amr fails closed');
select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute', '{"amr": [{"method": "totp", "timestamp": "now"}]}');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'non-numeric amr timestamp fails closed');
select pg_temp.login('00000000-0000-4000-8000-000000000003', null, '{"aal": "aal2"}');
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), false, 'aal2 with only an email-code amr is denied');
select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute',
  jsonb_build_object('amr', jsonb_build_array(jsonb_build_object('method', 'webauthn', 'timestamp', extract(epoch from now())::bigint))));
select is(private.is_privileged('10000000-0000-4000-8000-00000000000a'), true, 'fresh webauthn counts as MFA');

-- Admin u2 (no employee row) -------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000002');
select is((select count(*) from public.employees), 0::bigint, 'admin without aal2 sees no employees');
select results_eq('select id from public.memberships', $$values ('30000000-0000-4000-8000-000000000002'::uuid)$$, 'admin without aal2 sees only own membership');

select pg_temp.login('00000000-0000-4000-8000-000000000002', '1 minute');
select is((select count(*) from public.employees), 6::bigint, 'admin with aal2 sees every employee of the org, incl. kiosk-only');
select is((select count(*) from public.memberships), 6::bigint, 'admin with aal2 sees every membership of the org');
select is((select count(*) from public.site_assignments), 8::bigint, 'admin with aal2 sees every site assignment of the org');
select is(
  (select count(*) from public.employees where organization_id = '10000000-0000-4000-8000-00000000000b')
  + (select count(*) from public.memberships where organization_id = '10000000-0000-4000-8000-00000000000b')
  + (select count(*) from public.sites where organization_id = '10000000-0000-4000-8000-00000000000b')
  + (select count(*) from public.organizations where id = '10000000-0000-4000-8000-00000000000b')
  + (select count(*) from public.site_assignments where organization_id = '10000000-0000-4000-8000-00000000000b'),
  0::bigint, 'admin of org A sees nothing of org B'
);

-- Owner B (aal2): cross-tenant denial on every table ---------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000006', '1 minute');
select is((select count(*) from public.organizations where id = '10000000-0000-4000-8000-00000000000a'), 0::bigint, 'owner B cannot see org A');
select is((select count(*) from public.sites where organization_id = '10000000-0000-4000-8000-00000000000a'), 0::bigint, 'owner B cannot see sites of org A');
select is((select count(*) from public.memberships where organization_id = '10000000-0000-4000-8000-00000000000a'), 0::bigint, 'owner B cannot see memberships of org A');
select is((select count(*) from public.employees where organization_id = '10000000-0000-4000-8000-00000000000a'), 0::bigint, 'owner B cannot see employees of org A');
select is((select count(*) from public.site_assignments where organization_id = '10000000-0000-4000-8000-00000000000a'), 0::bigint, 'owner B cannot see site assignments of org A');
select is((select count(*) from public.employees), 1::bigint, 'owner B sees own org employees');

select throws_ok(
  $$insert into public.organizations (name) values ('Rogue')$$,
  '42501', null, 'owner cannot insert organizations directly'
);
select throws_ok(
  $$insert into public.sites (organization_id, name) values ('10000000-0000-4000-8000-00000000000a', 'Rogue')$$,
  '42501', null, 'owner B cannot insert a site into org A'
);
select throws_ok(
  $$insert into public.memberships (organization_id, user_id, role, status)
    values ('10000000-0000-4000-8000-00000000000a', '00000000-0000-4000-8000-000000000006', 'owner', 'active')$$,
  '42501', null, 'owner B cannot insert a membership into org A'
);
select throws_ok(
  $$insert into public.employees (organization_id, display_name) values ('10000000-0000-4000-8000-00000000000a', 'Rogue')$$,
  '42501', null, 'owner B cannot insert an employee into org A'
);
select throws_ok(
  $$insert into public.site_assignments (organization_id, site_id, employee_id)
    values ('10000000-0000-4000-8000-00000000000a', '20000000-0000-4000-8000-0000000000a1', '40000000-0000-4000-8000-000000000004')$$,
  '42501', null, 'owner B cannot insert a site assignment into org A'
);

-- Suspended u7 and non-member u9 -------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000007');
select is(
  (select count(*) from public.organizations) + (select count(*) from public.sites)
  + (select count(*) from public.employees) + (select count(*) from public.site_assignments),
  0::bigint, 'suspended member sees no org data'
);
select is((select status from public.memberships), 'suspended', 'suspended member can see own membership status');

select pg_temp.login('00000000-0000-4000-8000-000000000009', '1 minute');
select is(
  (select count(*) from public.organizations) + (select count(*) from public.sites)
  + (select count(*) from public.memberships) + (select count(*) from public.employees)
  + (select count(*) from public.site_assignments),
  0::bigint, 'user without membership sees nothing'
);

-- require_privileged (RPC-body helper) ------------------------------------------

reset role;
select pg_temp.login('00000000-0000-4000-8000-000000000003');
select throws_ok(
  $$select private.require_privileged('10000000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized', 'require_privileged raises for a manager without aal2'
);
select pg_temp.login('00000000-0000-4000-8000-000000000003', '1 minute');
select is(
  (private.require_privileged('10000000-0000-4000-8000-00000000000a')).id,
  '30000000-0000-4000-8000-000000000003'::uuid, 'require_privileged returns the membership of an aal2 manager'
);
select throws_ok(
  $$select private.require_privileged('10000000-0000-4000-8000-00000000000b')$$,
  '42501', 'not_authorized', 'require_privileged raises for another org'
);

-- create_organization bootstrap ---------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000009', '1 minute');
select throws_ok(
  $$select * from private.create_organization('Rogue', '00000000-0000-4000-8000-000000000009')$$,
  '42501', null, 'authenticated cannot bootstrap an organization'
);
reset role;

create temporary table bootstrap (
  organization_id uuid, site_id uuid, membership_id uuid, employee_id uuid
) on commit drop;
grant insert on bootstrap to service_role;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
insert into bootstrap
select * from private.create_organization('  Org C  ', '00000000-0000-4000-8000-000000000009', 'Owner C');
reset role;

select is((select name from public.organizations where id = (select organization_id from bootstrap)), 'Org C', 'bootstrap creates the organization');
select is(
  (select count(*) from public.sites where id = (select site_id from bootstrap) and organization_id = (select organization_id from bootstrap)),
  1::bigint, 'bootstrap creates a default site'
);
select results_eq(
  $$select role, status from public.memberships where id = (select membership_id from bootstrap)$$,
  $$values ('owner'::text, 'active'::text)$$,
  'bootstrap creates an active owner membership'
);
select results_eq(
  $$select user_id, display_name from public.employees where id = (select employee_id from bootstrap)$$,
  $$values ('00000000-0000-4000-8000-000000000009'::uuid, 'Owner C'::text)$$,
  'bootstrap creates the owner employee row'
);
select is(
  (select count(*) from public.site_assignments
   where employee_id = (select employee_id from bootstrap) and site_id = (select site_id from bootstrap)),
  1::bigint, 'bootstrap assigns the owner to the default site'
);
select results_eq(
  $$select action, entity, entity_id, actor_user_id from public.audit_log where organization_id = (select organization_id from bootstrap)$$,
  $$select 'organization.created'::text, 'organization'::text, organization_id, null::uuid from bootstrap$$,
  'bootstrap writes exactly one system audit row'
);

select * from finish();
rollback;
