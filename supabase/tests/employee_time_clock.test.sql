begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(78);

-- Synthetic transaction-only identities and sessions. Password values cannot
-- authenticate and every row is rolled back after this file.
with fixtures(number, email) as (values
  (1, 'clock.employee-a@example.test'),
  (2, 'clock.manager-a@example.test'),
  (3, 'clock.employee-b@example.test'),
  (4, 'clock.inactive@example.test'),
  (5, 'clock.suspended@example.test'),
  (6, 'clock.unaffiliated@example.test'),
  (7, 'clock.multiple-memberships@example.test'),
  (8, 'clock.sessionless@example.test'),
  (9, 'clock.expired-session@example.test'),
  (10, 'clock.multiple-worksites@example.test'),
  (11, 'clock.overnight@example.test')
)
insert into auth.users (id, email, email_confirmed_at, encrypted_password)
select ('91000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  email, now() - interval '1 day', 'transaction-only-not-a-password-hash'
from fixtures;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select ('92000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  ('91000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  now(), now(), case when number = 9 then now() - interval '1 hour' else null end
from generate_series(1, 11) as numbers(number)
where number <> 8;

insert into public.organizations (id, name, lifecycle_status) values
  ('93000000-0000-4000-8000-000000000001', 'Clock organization A', 'research_pilot'),
  ('93000000-0000-4000-8000-000000000002', 'Clock organization B', 'paid_beta'),
  ('93000000-0000-4000-8000-000000000003', 'Clock suspended organization', 'suspended'),
  ('93000000-0000-4000-8000-000000000004', 'Clock multiple-worksite organization', 'research_pilot');

insert into public.worksites (id, organization_id, name) values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 'Clock worksite A'),
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', 'Clock worksite B'),
  ('94000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000003', 'Clock suspended worksite'),
  ('94000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000004', 'Clock worksite C1'),
  ('94000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000004', 'Clock worksite C2');

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('95000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('95000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000004', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000004', 'employee', 'inactive'),
  ('95000000-0000-4000-8000-000000000005', '93000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000005', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000007', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000007', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000008', '93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000007', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000009', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000008', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000010', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000009', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000011', '93000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000010', 'employee', 'active'),
  ('95000000-0000-4000-8000-000000000012', '93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000011', 'employee', 'active');

insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at)
values('9f000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000002','Synthetic manager TOTP','totp','verified',now(),now());
update auth.sessions set factor_id='9f000000-0000-4000-8000-000000000002',aal='aal2'
where id='92000000-0000-4000-8000-000000000002';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values('9e000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000002',now(),now(),'totp');
insert into private.manager_mfa_registrations(auth_user_id,provider_factor_id)
values('91000000-0000-4000-8000-000000000002','9f000000-0000-4000-8000-000000000002');

insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at, created_at
) values
  ('96000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001', '94000000-0000-4000-8000-000000000001', now() - interval '2 hours', now() - interval '1 hour', now() - interval '2 hours'),
  ('96000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000003', '94000000-0000-4000-8000-000000000002', now() - interval '3 hours', now() - interval '2 hours', now() - interval '3 hours'),
  ('96000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000003', '95000000-0000-4000-8000-000000000005', '94000000-0000-4000-8000-000000000003', now() - interval '4 hours', now() - interval '3 hours', now() - interval '4 hours');

with bounds as (
  select (now() at time zone 'Europe/Brussels')::date::timestamp
    at time zone 'Europe/Brussels' as day_start
)
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at, created_at
)
select entry.id, entry.organization_id, entry.membership_id, entry.worksite_id,
  bounds.day_start + entry.start_offset,
  case when entry.end_offset is null then null
    else bounds.day_start + entry.end_offset end,
  bounds.day_start + entry.start_offset
from bounds
cross join (values
  ('96000000-0000-4000-8000-000000000004'::uuid, '93000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000012'::uuid, '94000000-0000-4000-8000-000000000001'::uuid, interval '-1 hour', null::interval),
  ('96000000-0000-4000-8000-000000000005'::uuid, '93000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000012'::uuid, '94000000-0000-4000-8000-000000000001'::uuid, interval '-3 hours', interval '-2 hours'),
  ('96000000-0000-4000-8000-000000000006'::uuid, '93000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000012'::uuid, '94000000-0000-4000-8000-000000000001'::uuid, interval '-1 hour', interval '0 hours'),
  ('96000000-0000-4000-8000-000000000007'::uuid, '93000000-0000-4000-8000-000000000002'::uuid, '95000000-0000-4000-8000-000000000003'::uuid, '94000000-0000-4000-8000-000000000002'::uuid, interval '-1 hour', interval '1 hour'),
  ('96000000-0000-4000-8000-000000000008'::uuid, '93000000-0000-4000-8000-000000000001'::uuid, '95000000-0000-4000-8000-000000000007'::uuid, '94000000-0000-4000-8000-000000000001'::uuid, interval '-1 hour', interval '1 hour')
) as entry(id, organization_id, membership_id, worksite_id, start_offset, end_offset);

-- Schema, indexes, tenant-consistent references, RLS, and exact privileges.
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.time_entries'::regclass),
  'time entries have RLS enabled'
);
select col_type_is('public', 'time_entries', 'started_at', 'timestamp with time zone', 'start uses timestamptz');
select col_type_is('public', 'time_entries', 'ended_at', 'timestamp with time zone', 'end uses timestamptz');
select ok(
  exists (select 1 from pg_catalog.pg_indexes
    where schemaname = 'public' and indexname = 'time_entries_one_open_per_membership_key'
      and indexdef ~ 'UNIQUE' and indexdef ~ 'WHERE [(]ended_at IS NULL[)]'),
  'partial unique index enforces one open entry per membership'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.time_entries'::regclass
      and conname = 'time_entries_membership_tenant_fkey' and contype = 'f'),
  'membership foreign key includes tenant'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.time_entries'::regclass
      and conname = 'time_entries_worksite_tenant_fkey' and contype = 'f'),
  'worksite foreign key includes tenant'
);
select throws_ok(
  $$insert into public.time_entries (organization_id, membership_id, worksite_id, started_at)
    values ('93000000-0000-4000-8000-000000000002', '95000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000002', now())$$,
  '23503', null, 'cross-tenant membership association is rejected'
);
select throws_ok(
  $$insert into public.time_entries (organization_id, membership_id, worksite_id, started_at)
    values ('93000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000002', now())$$,
  '23503', null, 'cross-tenant worksite association is rejected'
);
select throws_ok(
  $$insert into public.time_entries (organization_id, membership_id, worksite_id, started_at, ended_at)
    values ('93000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001', now(), now() - interval '1 second')$$,
  '23514', null, 'entry end cannot precede start'
);
select is(
  array(
    select privilege_name
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privileges(privilege_name)
    where has_table_privilege(expected.role_name, 'public.time_entries', privilege_name)
    order by privilege_name
  ),
  expected.allowed,
  expected.role_name || ' has exact time-entry privileges'
)
from (values
  ('anon', array[]::text[]),
  ('authenticated', array['SELECT']::text[]),
  ('service_role', array['SELECT']::text[])
) as expected(role_name, allowed);
select ok(
  not has_table_privilege('anon', 'private.time_clock_requests', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'private.time_clock_requests', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('service_role', 'private.time_clock_requests', 'SELECT, INSERT, UPDATE, DELETE'),
  'idempotency ledger has no application-role table privileges'
);
select is(
  (select proargnames from pg_catalog.pg_proc where oid = 'public.clock_in(uuid)'::regprocedure),
  array['request_id', 'request_id', 'result_code', 'did_transition', 'time_entry_id',
    'worksite_id', 'started_at', 'ended_at']::text[],
  'clock-in accepts only request ID before output columns'
);
select is(
  (select pronargs::integer from pg_catalog.pg_proc where oid = 'public.clock_out(uuid)'::regprocedure),
  1, 'clock-out accepts only one browser field'
);
select ok(
  not exists (select 1 from pg_catalog.pg_proc
    where pronamespace = 'public'::regnamespace and proname in ('clock_in', 'clock_out') and prosecdef),
  'exposed clock RPCs are never SECURITY DEFINER'
);
select ok(
  function_record.proowner = 'postgres'::regrole
  and function_record.prosecdef = expected.is_definer
  and function_record.proconfig = array['search_path=""']
  and (
    select array_agg(
      privilege.grantee::regrole::text || ':' || privilege.privilege_type
      || ':' || privilege.is_grantable::text || ':' || privilege.grantor::regrole::text
      order by privilege.grantee::regrole::text
    ) from pg_catalog.aclexplode(
      coalesce(function_record.proacl, pg_catalog.acldefault('f', function_record.proowner))
    ) as privilege
  ) = array['authenticated:EXECUTE:false:postgres', 'postgres:EXECUTE:false:postgres'],
  expected.signature || ' has exact owner, security, path, and EXECUTE grants'
)
from (values
  ('private.can_read_own_time_entry(uuid,uuid)', true),
  ('private.clock_in(uuid)', true),
  ('private.clock_out(uuid)', true),
  ('private.get_employee_time_clock()', true),
  ('public.clock_in(uuid)', false),
  ('public.clock_out(uuid)', false),
  ('public.get_employee_time_clock()', false)
) as expected(signature, is_definer)
join pg_catalog.pg_proc as function_record on function_record.oid = expected.signature::regprocedure;

-- Anonymous and service roles cannot invoke employee RPCs.
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(statement.sql, '42501', null, 'anon cannot ' || statement.operation)
from (values
  ('clock in', $$select * from public.clock_in('97000000-0000-4000-8000-000000000001')$$),
  ('clock out', $$select * from public.clock_out('97000000-0000-4000-8000-000000000002')$$),
  ('read clock state', $$select public.get_employee_time_clock()$$),
  ('read time entries', $$select * from public.time_entries$$)
) as statement(operation, sql);

reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(statement.sql, '42501', null, 'service role cannot ' || statement.operation)
from (values
  ('clock in as arbitrary actor', $$select * from public.clock_in('97000000-0000-4000-8000-000000000003')$$),
  ('clock out as arbitrary actor', $$select * from public.clock_out('97000000-0000-4000-8000-000000000004')$$)
) as statement(operation, sql);

-- Active employee sees only own tenant rows and cannot write directly.
reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select is((select count(*) from public.time_entries), 1::bigint, 'employee reads only own time entries');
select is(
  (select id from public.time_entries),
  '96000000-0000-4000-8000-000000000001'::uuid,
  'cross-tenant and suspended entries are hidden'
);
select throws_ok(
  $$insert into public.time_entries (organization_id, membership_id, worksite_id, started_at)
    values ('93000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001', '2000-01-01Z')$$,
  '42501', null, 'authenticated employee has no direct insert'
);
select throws_ok(
  $$update public.time_entries set ended_at = now() where id = '96000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated employee has no direct update'
);
select throws_ok(
  $$delete from public.time_entries where id = '96000000-0000-4000-8000-000000000001'$$,
  '42501', null, 'authenticated employee has no direct delete'
);
select throws_ok(
  $$select * from public.clock_in('97000000-0000-4000-8000-000000000099',
    '93000000-0000-4000-8000-000000000002')$$,
  '42883', null, 'browser-supplied tenant authority is rejected by function signature'
);

-- Brussels-local today uses half-open interval overlap, including overnight work.
reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000011","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000011"}';
select ok(
  (public.get_employee_time_clock() -> 'entries')
    @> '[{"id":"96000000-0000-4000-8000-000000000004"}]'::jsonb,
  'open entry beginning before local midnight overlaps today'
);
select lives_ok(
  $$select * from public.clock_out('97000000-0000-4000-8000-000000000024')$$,
  'overnight entry closes through controlled clock-out'
);
select ok(
  (select ended_at is not null from public.time_entries
    where id = '96000000-0000-4000-8000-000000000004'),
  'overnight entry is closed'
);
select ok(
  (public.get_employee_time_clock() -> 'entries')
    @> '[{"id":"96000000-0000-4000-8000-000000000004"}]'::jsonb,
  'completed entry spanning local midnight remains visible after clock-out'
);
select ok(
  not (public.get_employee_time_clock() -> 'entries')
    @> '[{"id":"96000000-0000-4000-8000-000000000005"}]'::jsonb,
  'entry entirely before today is excluded'
);
select ok(
  not (public.get_employee_time_clock() -> 'entries')
    @> '[{"id":"96000000-0000-4000-8000-000000000006"}]'::jsonb,
  'entry ending exactly at local day start is excluded'
);
select ok(
  not (public.get_employee_time_clock() -> 'entries')
    @> '[{"id":"96000000-0000-4000-8000-000000000007"}]'::jsonb,
  'overlapping entry from another tenant remains excluded'
);
select ok(
  not (public.get_employee_time_clock() -> 'entries')
    @> '[{"id":"96000000-0000-4000-8000-000000000008"}]'::jsonb,
  'overlapping entry from another employee remains excluded'
);

-- Manager, inactive, suspended, unaffiliated, ambiguous, and invalid sessions fail closed.
reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000002","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select throws_ok($$select * from public.clock_in('97000000-0000-4000-8000-000000000010')$$,
  '42501', null, 'manager cannot clock as employee');
select is((select count(*) from public.time_entries), 5::bigint, 'manager reads own tenant employee entries');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000004"}';
select throws_ok($$select * from public.clock_in('97000000-0000-4000-8000-000000000011')$$,
  '42501', null, 'inactive employee cannot clock in');
select is((select count(*) from public.time_entries), 0::bigint, 'inactive employee cannot read time entries');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000005"}';
select throws_ok($$select * from public.clock_out('97000000-0000-4000-8000-000000000012')$$,
  '42501', null, 'suspended-organization employee cannot clock out');
select is((select count(*) from public.time_entries), 0::bigint, 'suspension removes time-entry reads');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000006"}';
select throws_ok($$select * from public.clock_in('97000000-0000-4000-8000-000000000013')$$,
  '42501', null, 'unaffiliated user cannot clock in');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000007"}';
select throws_ok($$select * from public.clock_in('97000000-0000-4000-8000-000000000014')$$,
  '42501', null, 'employee with multiple active tenants cannot clock arbitrarily');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000008","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000008"}';
select throws_ok($$select * from public.clock_in('97000000-0000-4000-8000-000000000015')$$,
  '42501', null, 'sessionless employee cannot clock in');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000009","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000009"}';
select throws_ok($$select * from public.clock_out('97000000-0000-4000-8000-000000000016')$$,
  '42501', null, 'expired-session employee cannot clock out');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000010","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000010"}';
select throws_ok($$select * from public.clock_in('97000000-0000-4000-8000-000000000017')$$,
  '55000', null, 'multiple worksites fail closed instead of selecting browser authority');

-- Real transitions, retries, safe no-ops, database time, one-open invariant, and audits.
reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$select * from public.clock_in('97000000-0000-4000-8000-000000000020')$$,
  'active employee clocks in'
);

reset role;
select is(
  (select count(*) from public.time_entries
    where membership_id = '95000000-0000-4000-8000-000000000001' and ended_at is null),
  1::bigint, 'clock-in creates exactly one open entry'
);
select is(
  (select organization_id from public.time_entries
    where membership_id = '95000000-0000-4000-8000-000000000001' and ended_at is null),
  '93000000-0000-4000-8000-000000000001'::uuid,
  'clock-in derives organization from membership'
);
select is(
  (select worksite_id from public.time_entries
    where membership_id = '95000000-0000-4000-8000-000000000001' and ended_at is null),
  '94000000-0000-4000-8000-000000000001'::uuid,
  'clock-in derives sole worksite from database'
);
select ok(
  (select started_at = created_at and started_at between now() - interval '5 seconds' and clock_timestamp()
    from public.time_entries
    where membership_id = '95000000-0000-4000-8000-000000000001' and ended_at is null),
  'clock-in timestamp is current database time'
);
select is(
  (select count(*) from public.audit_events where action = 'time_entry.clocked_in'
    and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  1::bigint, 'real clock-in appends one audit'
);
select is(
  (select jsonb_build_object('before', before_data, 'after', after_data)
    from public.audit_events where action = 'time_entry.clocked_in'
      and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  '{"before":null,"after":{"state":"working"}}'::jsonb,
  'clock-in audit payload is minimal'
);

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select is(
  (select result_code from public.clock_in('97000000-0000-4000-8000-000000000020')),
  'started', 'same clock-in request replays original result'
);
select is(
  (select result_code from public.clock_in('97000000-0000-4000-8000-000000000021')),
  'already_working', 'different rapid clock-in request returns safe current state'
);

reset role;
select is((select count(*) from public.time_entries
  where membership_id = '95000000-0000-4000-8000-000000000001' and ended_at is null),
  1::bigint, 'retries and rapid calls cannot create another open entry');
select is((select count(*) from public.audit_events where action = 'time_entry.clocked_in'
  and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  1::bigint, 'clock-in retry and no-op append no audits');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select throws_ok(
  $$select * from public.clock_out('97000000-0000-4000-8000-000000000020')$$,
  '22023', null, 'one request ID cannot change operation'
);
select lives_ok(
  $$select * from public.clock_out('97000000-0000-4000-8000-000000000022')$$,
  'active employee clocks out'
);

reset role;
select is((select count(*) from public.time_entries
  where membership_id = '95000000-0000-4000-8000-000000000001' and ended_at is null),
  0::bigint, 'clock-out closes open entry once');
select ok((select ended_at >= started_at and ended_at between now() - interval '5 seconds' and clock_timestamp()
  from public.time_entries where membership_id = '95000000-0000-4000-8000-000000000001'
  order by started_at desc limit 1), 'clock-out uses current database time');
select is((select count(*) from public.audit_events where action = 'time_entry.clocked_out'
  and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  1::bigint, 'real clock-out appends one audit');
select is(
  (select jsonb_build_object('before', before_data, 'after', after_data)
    from public.audit_events where action = 'time_entry.clocked_out'
      and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  '{"before":{"state":"working"},"after":{"state":"stopped"}}'::jsonb,
  'clock-out audit payload is minimal'
);

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"91000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"92000000-0000-4000-8000-000000000001"}';
select is(
  (select result_code from public.clock_out('97000000-0000-4000-8000-000000000022')),
  'stopped', 'same clock-out request replays original result'
);
select is(
  (select result_code from public.clock_out('97000000-0000-4000-8000-000000000023')),
  'already_stopped', 'second clock-out returns safe current state'
);
select is(
  (public.get_employee_time_clock() ->> 'status'),
  'not_working', 'state RPC reports stopped state'
);
select ok(
  jsonb_array_length(public.get_employee_time_clock() -> 'entries') >= 2,
  'state RPC returns current Brussels-local day registrations'
);

reset role;
select is((select count(*) from public.audit_events where action = 'time_entry.clocked_out'
  and actor_user_id = '91000000-0000-4000-8000-000000000001'),
  1::bigint, 'clock-out retry and no-op append no audits');
select is((select count(*) from private.time_clock_requests
  where membership_id = '95000000-0000-4000-8000-000000000001'),
  4::bigint, 'each distinct accepted request has one immutable outcome');

insert into public.time_entries (
  organization_id, membership_id, worksite_id, started_at
) values (
  '93000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
  '94000000-0000-4000-8000-000000000001', now()
);
select throws_ok(
  $$insert into public.time_entries (organization_id, membership_id, worksite_id, started_at)
    values ('93000000-0000-4000-8000-000000000001', '95000000-0000-4000-8000-000000000001',
      '94000000-0000-4000-8000-000000000001', now())$$,
  '23505', null, 'database constraint rejects a second open entry'
);

select * from finish();
rollback;
