begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select no_plan();

with fixtures(number, email) as (values
  (1, 'correction.employee-a@example.test'),
  (2, 'correction.manager-a@example.test'),
  (3, 'correction.employee-b@example.test'),
  (4, 'correction.inactive@example.test'),
  (5, 'correction.suspended@example.test'),
  (6, 'correction.sessionless@example.test'),
  (7, 'correction.multiple@example.test'),
  (8, 'correction.open-entry@example.test')
)
insert into auth.users (id, email, email_confirmed_at, encrypted_password)
select ('a1000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  email, now() - interval '1 day', 'transaction-only-not-a-password-hash'
from fixtures;

insert into auth.sessions (id, user_id, created_at, updated_at)
select ('a2000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  ('a1000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  now(), now()
from generate_series(1, 8) as numbers(number)
where number <> 6;

insert into public.organizations (id, name, lifecycle_status) values
  ('a3000000-0000-4000-8000-000000000001', 'Correction organization A', 'research_pilot'),
  ('a3000000-0000-4000-8000-000000000002', 'Correction organization B', 'paid_beta'),
  ('a3000000-0000-4000-8000-000000000003', 'Correction suspended', 'suspended');

insert into public.worksites (id, organization_id, name) values
  ('a4000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'Correction worksite A'),
  ('a4000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000002', 'Correction worksite B'),
  ('a4000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000003', 'Correction suspended worksite');

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('a5000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'employee', 'active'),
  ('a5000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('a5000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000003', 'employee', 'active'),
  ('a5000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000004', 'employee', 'inactive'),
  ('a5000000-0000-4000-8000-000000000005', 'a3000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000005', 'employee', 'active'),
  ('a5000000-0000-4000-8000-000000000006', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000006', 'employee', 'active'),
  ('a5000000-0000-4000-8000-000000000007', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000007', 'employee', 'active'),
  ('a5000000-0000-4000-8000-000000000008', 'a3000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000007', 'employee', 'active'),
  ('a5000000-0000-4000-8000-000000000009', 'a3000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000008', 'employee', 'active');

insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at, created_at
) values
  ('a6000000-0000-4000-8000-000000000001', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', '2026-08-10 08:00Z', '2026-08-10 10:00Z', '2026-08-10 08:00Z'),
  ('a6000000-0000-4000-8000-000000000002', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001', 'a4000000-0000-4000-8000-000000000001', '2026-08-10 11:00Z', '2026-08-10 12:00Z', '2026-08-10 11:00Z'),
  ('a6000000-0000-4000-8000-000000000003', 'a3000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000003', 'a4000000-0000-4000-8000-000000000002', '2026-08-10 08:00Z', '2026-08-10 09:00Z', '2026-08-10 08:00Z'),
  ('a6000000-0000-4000-8000-000000000004', 'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000009', 'a4000000-0000-4000-8000-000000000001', '2026-08-15 08:00Z', null, '2026-08-15 08:00Z');

-- Schema constraints, tenant consistency, indexes, grants, and RLS.
select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.correction_requests'::regclass),
  'correction requests have RLS enabled'
);
select col_type_is('public', 'correction_requests', 'proposed_started_at', 'timestamp with time zone', 'proposed start uses timestamptz');
select col_type_is('public', 'correction_requests', 'proposed_ended_at', 'timestamp with time zone', 'proposed end uses timestamptz');
select col_type_is('public', 'correction_requests', 'created_at', 'timestamp with time zone', 'creation time uses immutable timestamptz field');
select ok(
  exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.correction_requests'::regclass
      and conname = 'correction_requests_tenant_membership_fkey' and contype = 'f'),
  'employee membership foreign key includes tenant'
);
select ok(
  exists (select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.correction_requests'::regclass
      and conname = 'correction_requests_target_entry_fkey' and contype = 'f'),
  'target entry foreign key includes tenant, employee, and worksite'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'correction_requests_one_pending_adjustment_per_entry_key'
      and indexdef ~ 'UNIQUE'),
  'partial unique index permits one pending adjustment per entry'
);
select ok(
  exists (select 1 from pg_catalog.pg_indexes
    where schemaname = 'public'
      and indexname = 'correction_requests_employee_pending_interval_idx'),
  'pending interval lookup has employee index'
);
select is(
  array(
    select privilege_name
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privileges(privilege_name)
    where has_table_privilege(expected.role_name, 'public.correction_requests', privilege_name)
    order by privilege_name
  ),
  expected.allowed,
  expected.role_name || ' has exact correction-request privileges'
)
from (values
  ('anon', array[]::text[]),
  ('authenticated', array['SELECT']::text[]),
  ('service_role', array['SELECT']::text[])
) as expected(role_name, allowed);
select ok(
  not has_table_privilege('anon', 'private.correction_request_operations', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'private.correction_request_operations', 'SELECT, INSERT, UPDATE, DELETE')
  and not has_table_privilege('service_role', 'private.correction_request_operations', 'SELECT, INSERT, UPDATE, DELETE'),
  'correction idempotency ledger has no application-role privileges'
);
select ok(
  not exists (select 1 from pg_catalog.pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in (
        'submit_employee_correction_request',
        'withdraw_employee_correction_request',
        'get_employee_correction_requests'
      ) and prosecdef),
  'exposed correction RPCs are SECURITY INVOKER'
);
select is(
  (select pronargs::integer from pg_catalog.pg_proc
    where oid = 'public.submit_employee_correction_request(uuid,text,text,text,text,text,text,text)'::regprocedure),
  8,
  'submission RPC accepts only intent, request ID, target, proposal, disambiguation, and reason'
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
  ('private.can_read_own_correction_request(uuid,uuid)', true),
  ('private.submit_employee_correction_request(uuid,text,uuid,text,text,text,text,text)', true),
  ('private.withdraw_employee_correction_request(uuid,uuid)', true),
  ('private.get_employee_correction_requests()', true),
  ('public.submit_employee_correction_request(uuid,text,text,text,text,text,text,text)', false),
  ('public.withdraw_employee_correction_request(uuid,uuid)', false),
  ('public.get_employee_correction_requests()', false)
) as expected(signature, is_definer)
join pg_catalog.pg_proc as function_record on function_record.oid = expected.signature::regprocedure;

select throws_ok(
  $$insert into public.correction_requests (
      organization_id, employee_membership_id, worksite_id, request_kind,
      proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
    ) values (
      'a3000000-0000-4000-8000-000000000002', 'a5000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000002', 'missed_entry',
      '2026-08-01 08:00Z', '2026-08-01 09:00Z', 'Cross tenant',
      'a7000000-0000-4000-8000-000000000001'
    )$$,
  '23503', null, 'cross-tenant employee association is rejected'
);
select throws_ok(
  $$insert into public.correction_requests (
      organization_id, employee_membership_id, worksite_id, request_kind,
      proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
    ) values (
      'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001', 'missed_entry',
      '2026-08-01 09:00Z', '2026-08-01 08:00Z', 'Verkeerde volgorde',
      'a7000000-0000-4000-8000-000000000002'
    )$$,
  '23514', null, 'proposal end must be strictly after start'
);
select throws_ok(
  $$insert into public.correction_requests (
      organization_id, employee_membership_id, worksite_id, request_kind,
      proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
    ) values (
      'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001', 'missed_entry',
      '2026-08-01 08:00Z', '2026-08-01 09:00Z', ' ',
      'a7000000-0000-4000-8000-000000000003'
    )$$,
  '23514', null, 'blank reasons are rejected by schema'
);
select throws_ok(
  $$insert into public.correction_requests (
      organization_id, employee_membership_id, worksite_id, target_time_entry_id,
      request_kind, proposed_started_at, proposed_ended_at, employee_reason,
      submission_request_id
    ) values (
      'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001',
      'missed_entry', '2026-08-01 08:00Z', '2026-08-01 09:00Z', 'Heeft onterecht doel',
      'a7000000-0000-4000-8000-000000000004'
    )$$,
  '23514', null, 'missed-entry row cannot reference factual entry'
);

-- Explicit Brussels conversion covers normal, midnight, spring gap, and autumn repeat.
select is(
  private.resolve_brussels_local('2026-02-10T09:15', null),
  '2026-02-10 08:15Z'::timestamptz,
  'ordinary Brussels wall time resolves to expected instant'
);
select is(
  private.resolve_brussels_local('2026-01-15T00:00', null),
  '2026-01-14 23:00Z'::timestamptz,
  'Brussels local midnight resolves without machine timezone'
);
select throws_ok(
  $$select private.resolve_brussels_local('2026-03-29T02:30', null)$$,
  '22008', 'correction_nonexistent_local_time',
  'spring-forward nonexistent local time is rejected'
);
select throws_ok(
  $$select private.resolve_brussels_local('2025-10-26T02:30', null)$$,
  '22023', 'correction_ambiguous_local_time',
  'autumn repeated local time requires disambiguation'
);
select is(
  private.resolve_brussels_local('2025-10-26T02:30', 'earlier'),
  '2025-10-26 00:30Z'::timestamptz,
  'earlier autumn occurrence selects summer-time instant'
);
select is(
  private.resolve_brussels_local('2025-10-26T02:30', 'later'),
  '2025-10-26 01:30Z'::timestamptz,
  'later autumn occurrence selects winter-time instant'
);
select throws_ok(
  $$select private.resolve_brussels_local('2026-02-30T09:15', null)$$,
  '22007', 'correction_invalid_local_time',
  'malformed calendar value is rejected'
);

-- Anonymous and service roles cannot invoke correction RPCs.
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000010', 'missed_entry', null,
    '2026-08-01T10:00', null, '2026-08-01T11:00', null, 'Vergeten registratie'
  )$$,
  '42501', null, 'anonymous caller cannot submit correction'
);
select throws_ok(
  $$select public.get_employee_correction_requests()$$,
  '42501', null, 'anonymous caller cannot read correction state'
);

reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select * from public.withdraw_employee_correction_request(
    'a7000000-0000-4000-8000-000000000011',
    'a8000000-0000-4000-8000-000000000001'
  )$$,
  '42501', null, 'service role cannot invoke employee withdrawal RPC'
);

-- Manager, inactive, suspended, sessionless, and multi-tenant callers fail closed.
reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000012', 'missed_entry', null,
    '2026-08-01T10:00', null, '2026-08-01T11:00', null, 'Manager claim'
  )$$,
  '42501', null, 'manager cannot submit employee correction'
);
select is((select count(*) from public.correction_requests), 0::bigint, 'manager reads no correction requests');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000004","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000004"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000013', 'missed_entry', null,
    '2026-08-01T10:00', null, '2026-08-01T11:00', null, 'Inactive claim'
  )$$,
  '42501', null, 'inactive employee cannot submit correction'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000005","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000005"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000014', 'missed_entry', null,
    '2026-08-01T10:00', null, '2026-08-01T11:00', null, 'Suspended claim'
  )$$,
  '42501', null, 'suspended organization cannot submit correction'
);
select is((select count(*) from public.correction_requests), 0::bigint, 'suspended employee reads no correction requests');

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000006","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000006"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000015', 'missed_entry', null,
    '2026-08-01T10:00', null, '2026-08-01T11:00', null, 'Sessionless claim'
  )$$,
  '42501', null, 'sessionless employee cannot submit correction'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000007","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000007"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000016', 'missed_entry', null,
    '2026-08-01T10:00', null, '2026-08-01T11:00', null, 'Ambiguous tenant claim'
  )$$,
  '42501', null, 'multiple active memberships fail closed'
);

-- Employee A can read own factual rows and submit only valid, past claims.
reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select throws_ok(
  $$insert into public.correction_requests (
      organization_id, employee_membership_id, worksite_id, request_kind,
      proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
    ) values (
      'a3000000-0000-4000-8000-000000000001', 'a5000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001', 'missed_entry',
      '2026-08-01 08:00Z', '2026-08-01 09:00Z', 'Direct write',
      'a7000000-0000-4000-8000-000000000020'
    )$$,
  '42501', null, 'employee cannot directly insert correction request'
);
select throws_ok(
  $$update public.correction_requests set status = 'withdrawn'$$,
  '42501', null, 'employee cannot directly update correction requests'
);
select throws_ok(
  $$delete from public.correction_requests$$,
  '42501', null, 'employee cannot directly delete correction requests'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000021', 'adjustment',
    'a6000000-0000-4000-8000-000000000003',
    '2026-08-10T10:15', null, '2026-08-10T11:00', null, 'Andere medewerker'
  )$$,
  '22023', 'correction_invalid_target', 'another employee entry cannot be targeted'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000022', 'adjustment',
    'a6000000-0000-4000-8000-000000000001',
    '2026-08-10T10:00', null, '2026-08-10T12:00', null, 'Geen wijziging'
  )$$,
  '22023', 'correction_unchanged', 'unchanged adjustment is rejected'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000023', 'missed_entry', null,
    '2026-08-10T13:30', null, '2026-08-10T14:30', null, 'Overlapt registratie'
  )$$,
  '22023', 'correction_factual_overlap', 'missed entry overlapping factual entry is rejected'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000024', 'adjustment',
    'a6000000-0000-4000-8000-000000000001',
    '2026-08-10T11:30', null, '2026-08-10T13:30', null, 'Overlapt ander feit'
  )$$,
  '22023', 'correction_factual_overlap', 'adjustment overlap excludes own target only'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000025', 'missed_entry', null,
    '2999-08-10T10:00', null, '2999-08-10T11:00', null, 'Toekomst'
  )$$,
  '22023', 'correction_interval_not_past', 'future proposal is rejected by database time'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000026', 'missed_entry', null,
    '2026-03-29T02:30', null, '2026-03-29T04:00', null, 'Lentegat'
  )$$,
  '22008', 'correction_nonexistent_local_time', 'submission rejects spring DST gap'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000027', 'missed_entry', null,
    '2025-10-26T02:30', null, '2025-10-26T03:30', null, 'Herhaald uur'
  )$$,
  '22023', 'correction_ambiguous_local_time', 'submission requires autumn disambiguation'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000028', 'missed_entry', null,
    'not-a-time', null, '2026-08-10T10:00', null, 'Ongeldig'
  )$$,
  '22007', 'correction_invalid_local_time', 'malformed wall time is rejected'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000029', 'missed_entry', null,
    '2026-08-12T12:00', null, '2026-08-12T11:00', null, 'Omgekeerd'
  )$$,
  '22023', 'correction_invalid_interval', 'end before start is rejected transactionally'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000030', 'missed_entry', null,
    '2026-08-12T10:00', null, '2026-08-12T11:00', null, '   '
  )$$,
  '22023', 'correction_invalid_reason', 'trimmed empty reason is rejected'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000031', 'missed_entry', null,
    '2026-08-12T10:00', null, '2026-08-12T11:00', null, repeat('x', 501)
  )$$,
  '22023', 'correction_invalid_reason', 'overlong reason is rejected'
);

select is(
  (select result_code from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000040', 'adjustment',
    'a6000000-0000-4000-8000-000000000001',
    '2026-08-10T10:15', null, '2026-08-10T12:00', null,
    '  Starttijd vergeten aan te passen.  '
  )),
  'submitted', 'valid adjustment request succeeds'
);
select is(
  (select jsonb_build_object(
    'kind', request_kind,
    'start', proposed_started_at,
    'end', proposed_ended_at,
    'original_start', original_started_at,
    'original_end', original_ended_at,
    'reason', employee_reason,
    'status', status
  ) from public.correction_requests
  where submission_request_id = 'a7000000-0000-4000-8000-000000000040'),
  jsonb_build_object(
    'kind', 'adjustment',
    'start', '2026-08-10 08:15Z'::timestamptz,
    'end', '2026-08-10 10:00Z'::timestamptz,
    'original_start', '2026-08-10 08:00Z'::timestamptz,
    'original_end', '2026-08-10 10:00Z'::timestamptz,
    'reason', 'Starttijd vergeten aan te passen.',
    'status', 'pending'
  ),
  'adjustment stores UTC proposal and immutable original snapshot'
);
select is(
  (select jsonb_build_object('start', started_at, 'end', ended_at)
    from public.time_entries where id = 'a6000000-0000-4000-8000-000000000001'),
  jsonb_build_object(
    'start', '2026-08-10 08:00Z'::timestamptz,
    'end', '2026-08-10 10:00Z'::timestamptz
  ),
  'adjustment leaves original factual entry unchanged'
);
reset role;
select is(
  (select count(*) from public.audit_events
    where action = 'correction_request.submitted'
      and actor_user_id = 'a1000000-0000-4000-8000-000000000001'),
  1::bigint, 'real adjustment submission appends one audit'
);
select is(
  (select jsonb_build_object('before', before_data, 'after', after_data)
    from public.audit_events
    where action = 'correction_request.submitted'
      and actor_user_id = 'a1000000-0000-4000-8000-000000000001'),
  '{"before":null,"after":{"status":"pending"}}'::jsonb,
  'submission audit excludes reason and proposed timestamps'
);
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select is(
  (select result_code from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000040', 'adjustment',
    'a6000000-0000-4000-8000-000000000001',
    '2026-08-10T10:15', null, '2026-08-10T12:00', null,
    '  Starttijd vergeten aan te passen.  '
  )),
  'submitted', 'identical request ID and payload replay original result'
);
select is(
  (select count(*) from public.correction_requests
    where submission_request_id = 'a7000000-0000-4000-8000-000000000040'),
  1::bigint, 'retry creates no duplicate correction request'
);
reset role;
select is(
  (select count(*) from public.audit_events
    where action = 'correction_request.submitted'
      and actor_user_id = 'a1000000-0000-4000-8000-000000000001'),
  1::bigint, 'submission retry creates no duplicate audit'
);
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000040', 'adjustment',
    'a6000000-0000-4000-8000-000000000001',
    '2026-08-10T10:30', null, '2026-08-10T12:00', null,
    '  Starttijd vergeten aan te passen.  '
  )$$,
  '22023', 'correction_request_id_reused', 'altered payload with reused request ID fails closed'
);
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000041', 'adjustment',
    'a6000000-0000-4000-8000-000000000001',
    '2026-08-10T10:30', null, '2026-08-10T11:45', null, 'Conflicterend voorstel'
  )$$,
  '22023', 'correction_pending_conflict', 'pending proposal conflict is rejected'
);
select is(
  (select result_code from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000042', 'missed_entry', null,
    '2026-08-11T23:30', null, '2026-08-12T01:00', null,
    'Volledige nachtdienst vergeten.'
  )),
  'submitted', 'valid overnight missed-entry request succeeds'
);
select is(
  (select jsonb_build_object(
    'target', target_time_entry_id,
    'start', proposed_started_at,
    'end', proposed_ended_at,
    'original_start', original_started_at,
    'original_end', original_ended_at
  ) from public.correction_requests
  where submission_request_id = 'a7000000-0000-4000-8000-000000000042'),
  jsonb_build_object(
    'target', null,
    'start', '2026-08-11 21:30Z'::timestamptz,
    'end', '2026-08-11 23:00Z'::timestamptz,
    'original_start', null,
    'original_end', null
  ),
  'overnight missed entry stores absolute instants without target snapshot'
);

-- RLS exposes only employee own requests across tenants.
select is((select count(*) from public.correction_requests), 2::bigint, 'employee reads own requests');
select is(
  jsonb_array_length(public.get_employee_correction_requests() -> 'requests'),
  2, 'employee state RPC returns own persisted requests'
);

reset role;
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, request_kind,
  proposed_started_at, proposed_ended_at, employee_reason,
  submission_request_id
) values (
  'a8000000-0000-4000-8000-000000000090',
  'a3000000-0000-4000-8000-000000000002',
  'a5000000-0000-4000-8000-000000000003',
  'a4000000-0000-4000-8000-000000000002', 'missed_entry',
  '2026-08-20 08:00Z', '2026-08-20 09:00Z', 'Andere tenant',
  'a7000000-0000-4000-8000-000000000090'
);

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select is((select count(*) from public.correction_requests), 2::bigint, 'cross-tenant correction request stays hidden');

-- Withdrawal enforces ownership, status, idempotency, and exactly-once audit.
select throws_ok(
  $$select * from public.withdraw_employee_correction_request(
    'a7000000-0000-4000-8000-000000000040',
    (select id from public.correction_requests
      where submission_request_id = 'a7000000-0000-4000-8000-000000000040')
  )$$,
  '22023', 'correction_request_id_reused', 'submission request ID cannot be reused for withdrawal'
);
select is(
  (select result_code from public.withdraw_employee_correction_request(
    'a7000000-0000-4000-8000-000000000050',
    (select id from public.correction_requests
      where submission_request_id = 'a7000000-0000-4000-8000-000000000040')
  )),
  'withdrawn', 'employee withdraws own pending request'
);
select is(
  (select status from public.correction_requests
    where submission_request_id = 'a7000000-0000-4000-8000-000000000040'),
  'withdrawn', 'withdrawal transitions only request status'
);
select is(
  (select result_code from public.withdraw_employee_correction_request(
    'a7000000-0000-4000-8000-000000000050',
    (select id from public.correction_requests
      where submission_request_id = 'a7000000-0000-4000-8000-000000000040')
  )),
  'withdrawn', 'same withdrawal request replays original result'
);
select is(
  (select result_code from public.withdraw_employee_correction_request(
    'a7000000-0000-4000-8000-000000000051',
    (select id from public.correction_requests
      where submission_request_id = 'a7000000-0000-4000-8000-000000000040')
  )),
  'already_withdrawn', 'different withdrawal request is safe idempotent no-op'
);
reset role;
select is(
  (select count(*) from public.audit_events
    where action = 'correction_request.withdrawn'
      and actor_user_id = 'a1000000-0000-4000-8000-000000000001'),
  1::bigint, 'withdrawal retry and no-op append exactly one audit'
);
select is(
  (select jsonb_build_object('before', before_data, 'after', after_data)
    from public.audit_events
    where action = 'correction_request.withdrawn'
      and actor_user_id = 'a1000000-0000-4000-8000-000000000001'),
  '{"before":{"status":"pending"},"after":{"status":"withdrawn"}}'::jsonb,
  'withdrawal audit contains status only'
);

select set_config(
  'app.test_employee_a_request_id',
  (select id::text from public.correction_requests
    where submission_request_id = 'a7000000-0000-4000-8000-000000000042'),
  true
);
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000003","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000003"}';
select throws_ok(
  $$select * from public.withdraw_employee_correction_request(
    'a7000000-0000-4000-8000-000000000052',
    current_setting('app.test_employee_a_request_id')::uuid
  )$$,
  '42501', null, 'another employee cannot withdraw request'
);

reset role;
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000008","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000008"}';
select throws_ok(
  $$select * from public.submit_employee_correction_request(
    'a7000000-0000-4000-8000-000000000053', 'adjustment',
    'a6000000-0000-4000-8000-000000000004',
    '2026-08-15T10:00', null, '2026-08-15T11:00', null, 'Open registratie'
  )$$,
  '22023', 'correction_invalid_target', 'open factual entry cannot be targeted'
);

reset role;
select is(
  (select count(*) from public.time_entries where id = 'a6000000-0000-4000-8000-000000000001'),
  1::bigint, 'correction workflow never deletes or replaces original entry'
);
select is(
  (select count(*) from private.correction_request_operations
    where employee_membership_id = 'a5000000-0000-4000-8000-000000000001'),
  4::bigint, 'accepted submit and withdrawal request IDs have one immutable outcome each'
);

-- Guard submitted facts and operation outcomes against accidental owner changes.
select throws_ok(format(
  'update public.correction_requests set %I = %s where submission_request_id = %L',
  field, replacement, 'a7000000-0000-4000-8000-000000000040'
), '55000', 'correction_request_immutable', field || ' stays immutable')
from (values
  ('original_started_at', 'original_started_at + interval ''1 second'''),
  ('created_at', 'created_at + interval ''1 second'''),
  ('employee_reason', '''Owner rewrite'''),
  ('submission_request_id', 'gen_random_uuid()')
) as cases(field, replacement);
select throws_ok(
  $$delete from public.correction_requests where submission_request_id = 'a7000000-0000-4000-8000-000000000040'$$,
  '55000', 'correction_request_immutable', 'submitted claims cannot be deleted'
);
select throws_ok(
  $$update private.correction_request_operations set result_code = 'already_withdrawn'$$,
  '55000', 'correction_operation_immutable', 'operation outcomes cannot be rewritten'
);
select throws_ok(
  $$delete from private.correction_request_operations$$,
  '55000', 'correction_operation_immutable', 'operation outcomes cannot be deleted'
);
select ok((select relrowsecurity from pg_class where oid = 'private.correction_request_operations'::regclass), 'private ledger has defense-in-depth RLS');
select is(private.resolve_brussels_local('2026-02-10T09:15:12.123456', null),
  '2026-02-10 08:15:12.123456Z'::timestamptz, 'resolver preserves exact microseconds');
select throws_ok($$select private.resolve_brussels_local('2026-02-10T09:15:60', null)$$,
  '22007', 'correction_invalid_local_time', 'normalized invalid seconds are rejected');

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select is((select request_status from public.submit_employee_correction_request(
  'a7000000-0000-4000-8000-000000000040', 'adjustment', 'a6000000-0000-4000-8000-000000000001',
  '2026-08-10T10:15', null, '2026-08-10T12:00', null, '  Starttijd vergeten aan te passen.  '
)), 'pending', 'submission replay after withdrawal preserves original response');
select throws_ok($$select * from public.submit_employee_correction_request(
  'a7000000-0000-4000-8000-000000000040', 'adjustment', 'a6000000-0000-4000-8000-000000000001',
  '2026-08-10T10:15', null, '2026-08-10T12:00', null, 'Changed reason'
)$$, '22023', 'correction_request_id_reused', 'reason change with reused UUID fails closed');
select throws_ok($$select * from public.submit_employee_correction_request(
  gen_random_uuid(), null, null, '2026-08-10T10:15', null, '2026-08-10T12:00', null, 'Missing kind'
)$$, '22023', 'correction_invalid_request', 'null request kind fails closed');
select throws_ok($$select * from public.submit_employee_correction_request(
  gen_random_uuid(), 'missed_entry', null, '2026-08-10T10:15', null, '2026-08-10T12:00', null, E'\t\n\r'
)$$, '22023', 'correction_invalid_reason', 'whitespace-only reason fails closed');
select throws_ok($$select * from public.withdraw_employee_correction_request(
  'a7000000-0000-4000-8000-000000000050', current_setting('app.test_employee_a_request_id')::uuid
)$$, '22023', 'correction_request_id_reused', 'withdrawal UUID cannot target different claim');
select is((select result_code from public.submit_employee_correction_request(
  'a7000000-0000-4000-8000-000000000060', 'missed_entry', null,
  '2025-10-26T02:30', 'earlier', '2025-10-26T02:45', 'later', 'Herhaald uur'
)), 'submitted', 'explicit autumn occurrences succeed through authenticated RPC');
select is((select proposed_ended_at - proposed_started_at from public.correction_requests
  where submission_request_id = 'a7000000-0000-4000-8000-000000000060'), interval '75 minutes',
  'autumn request stores disambiguated absolute duration');

-- Denials must hold with existing own data, not merely with an empty table.
reset role;
update auth.users set banned_until = now() + interval '1 day' where id = 'a1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.correction_requests), 0::bigint, 'banned employee cannot read own claims');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null, 'banned employee cannot load state');
reset role;
update auth.users set banned_until = null, deleted_at = now() where id = 'a1000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.correction_requests), 0::bigint, 'deleted Auth employee cannot read own claims');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null, 'deleted Auth employee cannot load state');
reset role;
update auth.users set deleted_at = null where id = 'a1000000-0000-4000-8000-000000000001';
update auth.sessions set not_after = now() - interval '1 second' where id = 'a2000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.correction_requests), 0::bigint, 'expired session cannot read own claims');
select throws_ok($$select * from public.withdraw_employee_correction_request(
  gen_random_uuid(), current_setting('app.test_employee_a_request_id')::uuid
)$$, '42501', null, 'expired session cannot withdraw own claim');
reset role;
update auth.sessions set not_after = null where id = 'a2000000-0000-4000-8000-000000000001';
update public.memberships set status = 'inactive' where id = 'a5000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.correction_requests), 0::bigint, 'inactive employee cannot read existing own claims');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null, 'inactive employee cannot load existing claims');
reset role;
update public.memberships set status = 'active' where id = 'a5000000-0000-4000-8000-000000000001';
update public.organizations set lifecycle_status = 'suspended' where id = 'a3000000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select count(*) from public.correction_requests), 0::bigint, 'suspended organization hides existing own claims');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null, 'suspended organization cannot load existing claims');
reset role;
update public.organizations set lifecycle_status = 'research_pilot' where id = 'a3000000-0000-4000-8000-000000000001';

set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000002","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002"}';
select is((select count(*) from public.correction_requests), 0::bigint, 'manager cannot read employee requests in own tenant');
select throws_ok($$select * from public.withdraw_employee_correction_request(
  gen_random_uuid(), current_setting('app.test_employee_a_request_id')::uuid
)$$, '42501', null, 'manager cannot withdraw employee request');
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000008","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000008"}';
select is((select count(*) from public.correction_requests), 0::bigint, 'same-tenant coworker cannot read claims');
select throws_ok($$select * from public.submit_employee_correction_request(
  gen_random_uuid(), 'adjustment', 'a6000000-0000-4000-8000-000000000001',
  '2026-08-10T10:15', null, '2026-08-10T12:00', null, 'Coworker target'
)$$, '22023', 'correction_invalid_target', 'same-tenant coworker cannot target closed entry');
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000002"}';
select is((select count(*) from public.correction_requests), 0::bigint, 'another user session cannot authenticate claim owner');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null, 'spoofed session fails state RPC');

-- Future decision states are read-only to employees and cannot be withdrawn.
reset role;
update public.correction_requests set status = 'rejected', resolved_at = now(),
  resolved_by_membership_id = 'a5000000-0000-4000-8000-000000000002', resolution_request_id = gen_random_uuid()
where submission_request_id = 'a7000000-0000-4000-8000-000000000042';
set local role authenticated;
set local "request.jwt.claims" =
  '{"sub":"a1000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"a2000000-0000-4000-8000-000000000001"}';
select throws_ok($$select * from public.withdraw_employee_correction_request(
  gen_random_uuid(), current_setting('app.test_employee_a_request_id')::uuid
)$$, '22023', 'correction_not_pending', 'rejected request cannot be withdrawn');
reset role;
update public.correction_requests set status = 'approved', resolved_at = now(),
  resolved_by_membership_id = 'a5000000-0000-4000-8000-000000000002', resolution_request_id = gen_random_uuid()
where submission_request_id = 'a7000000-0000-4000-8000-000000000060';
set local role authenticated;
select throws_ok($$select * from public.withdraw_employee_correction_request(
  gen_random_uuid(), (select id from public.correction_requests where submission_request_id = 'a7000000-0000-4000-8000-000000000060')
)$$, '22023', 'correction_not_pending', 'approved request cannot be withdrawn');
reset role;

select throws_ok($$truncate public.correction_requests cascade$$,
  '55000', 'correction_request_immutable', 'claim truncate guard rejects owner');
select throws_ok($$truncate private.correction_request_operations$$,
  '55000', 'correction_operation_immutable', 'ledger truncate guard rejects owner');

savepoint ambiguous_access;
insert into public.memberships (id, organization_id, user_id, role, status) values (
  'a5000000-0000-4000-8000-000000000099', 'a3000000-0000-4000-8000-000000000002',
  'a1000000-0000-4000-8000-000000000001', 'employee', 'active'
);
set local role authenticated;
select is((select count(*) from public.correction_requests), 0::bigint, 'ambiguous membership hides existing own claims');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null, 'ambiguous membership denies state RPC');
rollback to ambiguous_access;

savepoint multiple_worksites;
insert into public.worksites (organization_id, name) values ('a3000000-0000-4000-8000-000000000001', 'Second synthetic worksite');
set local role authenticated;
select throws_ok($$select public.get_employee_correction_requests()$$, '55000', null, 'multiple worksites deny state RPC');
select throws_ok($$select * from public.withdraw_employee_correction_request(gen_random_uuid(), current_setting('app.test_employee_a_request_id')::uuid)$$,
  '55000', null, 'multiple worksites deny withdrawal including retries');
rollback to multiple_worksites;

set local role authenticated;
select is((select result_code from public.submit_employee_correction_request(
  'a7000000-0000-4000-8000-000000000070', 'adjustment', 'a6000000-0000-4000-8000-000000000001',
  '2026-08-09T09:00', null, '2026-08-09T10:00', null, 'Nieuw voorstel na intrekking'
)), 'submitted', 'new adjustment allowed after prior claim withdrawn');
select throws_ok($$select * from public.submit_employee_correction_request(
  gen_random_uuid(), 'adjustment', 'a6000000-0000-4000-8000-000000000001',
  '2026-08-08T09:00', null, '2026-08-08T10:00', null, 'Disjoint duplicate target'
)$$, '22023', 'correction_pending_conflict', 'one pending adjustment per target even for disjoint proposals');
reset role;
set local timezone = 'America/Los_Angeles';
select is(private.resolve_brussels_local('2026-02-10T09:00', null),
  '2026-02-10T08:00Z'::timestamptz, 'database session timezone cannot reinterpret Brussels input');
select * from finish();
rollback;
