begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

create function pg_temp.export_id(prefix integer, number integer) returns uuid
language sql immutable as $$
  select (prefix::text || '00000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid
$$;
create function pg_temp.export_login(number integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.export_id(901, number), 'role', 'authenticated',
    'session_id', pg_temp.export_id(902, number)
  )::text, true)::text::void
$$;

insert into auth.users (
  id, email, email_confirmed_at, encrypted_password, banned_until, deleted_at
)
select pg_temp.export_id(901, n), 'export.fixture.' || n || '@example.test',
  case when n = 9 then null else now() - interval '1 day' end,
  'synthetic-not-a-password',
  case when n = 7 then now() + interval '1 day' end,
  case when n = 8 then now() end
from generate_series(1, 12) as n;
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select pg_temp.export_id(902, n), pg_temp.export_id(901, n), now(), now(),
  case when n = 6 then now() - interval '1 second' end
from generate_series(1, 12) as n where n <> 5;
insert into public.organizations (id, name, lifecycle_status) values
  (pg_temp.export_id(903, 1), 'Fictieve exportorganisatie', 'research_pilot'),
  (pg_temp.export_id(903, 2), 'Andere fictieve organisatie', 'paid_beta'),
  (pg_temp.export_id(903, 3), 'Geschorste fictieve organisatie', 'suspended');
insert into public.worksites (id, organization_id, name) values
  (pg_temp.export_id(904, 1), pg_temp.export_id(903, 1), 'Werkplek; "Noord"'),
  (pg_temp.export_id(904, 2), pg_temp.export_id(903, 2), 'Andere werkplek'),
  (pg_temp.export_id(904, 3), pg_temp.export_id(903, 3), 'Geschorste werkplek');
insert into public.memberships (
  id, organization_id, user_id, role, status, employee_code
) values
  (pg_temp.export_id(905, 1), pg_temp.export_id(903, 1), pg_temp.export_id(901, 1), 'manager', 'active', null),
  (pg_temp.export_id(905, 2), pg_temp.export_id(903, 1), pg_temp.export_id(901, 2), 'employee', 'active', ' =SYN,"1"'),
  (pg_temp.export_id(905, 3), pg_temp.export_id(903, 2), pg_temp.export_id(901, 3), 'manager', 'active', null),
  (pg_temp.export_id(905, 4), pg_temp.export_id(903, 1), pg_temp.export_id(901, 4), 'manager', 'inactive', null),
  (pg_temp.export_id(905, 5), pg_temp.export_id(903, 3), pg_temp.export_id(901, 5), 'manager', 'active', null),
  (pg_temp.export_id(905, 6), pg_temp.export_id(903, 1), pg_temp.export_id(901, 6), 'manager', 'active', null),
  (pg_temp.export_id(905, 7), pg_temp.export_id(903, 1), pg_temp.export_id(901, 7), 'manager', 'active', null),
  (pg_temp.export_id(905, 8), pg_temp.export_id(903, 1), pg_temp.export_id(901, 8), 'manager', 'active', null),
  (pg_temp.export_id(905, 9), pg_temp.export_id(903, 1), pg_temp.export_id(901, 9), 'manager', 'active', null),
  (pg_temp.export_id(905, 10), pg_temp.export_id(903, 1), pg_temp.export_id(901, 10), 'manager', 'active', null),
  (pg_temp.export_id(905, 11), pg_temp.export_id(903, 1), pg_temp.export_id(901, 11), 'employee', 'active', null),
  (pg_temp.export_id(905, 12), pg_temp.export_id(903, 1), pg_temp.export_id(901, 12), 'employee', 'active', 'SYN-LARGE');
insert into public.memberships (id, organization_id, user_id, role, status)
values (pg_temp.export_id(905, 20), pg_temp.export_id(903, 2), pg_temp.export_id(901, 10), 'manager', 'active');
insert into public.profiles (user_id, display_name)
select pg_temp.export_id(901, n),
  case when n = 2 then ' =SOM(1); "Élodie"' else 'Fictieve persoon ' || n end
from generate_series(1, 10) as n;
insert into public.profiles (user_id, display_name)
values (pg_temp.export_id(901, 12), 'Grote fictieve naam');

insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at
) values
  -- Jan 1 local overnight: belongs only to Jan 1.
  (pg_temp.export_id(906, 1), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2), pg_temp.export_id(904, 1),
    '2010-01-01 22:30:00.123456Z', '2010-01-02 01:00:00.123456Z'),
  (pg_temp.export_id(906, 2), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2), pg_temp.export_id(904, 1),
    '2010-01-02 07:00:00Z', '2010-01-02 08:00:00Z'),
  -- Spring-forward local date is March 28; elapsed duration is two hours.
  (pg_temp.export_id(906, 3), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2), pg_temp.export_id(904, 1),
    '2010-03-28 00:30:00Z', '2010-03-28 02:30:00Z'),
  -- Autumn repeat starts at first 02:30 (+02) and ends at 03:30 (+01).
  (pg_temp.export_id(906, 4), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2), pg_temp.export_id(904, 1),
    '2010-10-31 00:30:00.123456Z', '2010-10-31 02:30:00.123457Z'),
  (pg_temp.export_id(906, 5), pg_temp.export_id(903, 1), pg_temp.export_id(905, 11), pg_temp.export_id(904, 1),
    '2010-01-01 08:00:00Z', '2010-01-01 09:00:00Z'),
  (pg_temp.export_id(906, 20), pg_temp.export_id(903, 2), pg_temp.export_id(905, 20), pg_temp.export_id(904, 2),
    '2010-01-01 08:00:00Z', '2010-01-01 09:00:00Z');

-- One approved adjustment supplies a captured version and last correction reference.
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, target_time_entry_id,
  request_kind, proposed_started_at, proposed_ended_at, original_started_at,
  original_ended_at, original_time_entry_version, employee_reason, submission_request_id
) values (
  pg_temp.export_id(907, 1), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2),
  pg_temp.export_id(904, 1), pg_temp.export_id(906, 1), 'adjustment',
  '2010-01-01 22:45:00.123456Z', '2010-01-02 01:00:00.123456Z',
  '2010-01-01 22:30:00.123456Z', '2010-01-02 01:00:00.123456Z', 1,
  'Fictieve goedgekeurde correctie', pg_temp.export_id(908, 1)
);
set local role authenticated;
select pg_temp.export_login(1);
select is((select result_code from public.decide_correction_request(
  pg_temp.export_id(909, 1), pg_temp.export_id(907, 1), 'approve', ''
)), 'approved', 'approved correction prepares exact current factual version');
reset role;

-- Exact structure, owners, search paths, grants, and browser exposure.
select columns_are('public', 'time_exports', array[
  'id','organization_id','worksite_id','schema_version','selection_rule','timezone',
  'period_start_local','period_end_local','created_at','record_count','employee_count',
  'total_duration_microseconds','dataset_sha256'
]);
select columns_are('private', 'time_export_rows', array[
  'export_id','organization_id','row_ordinal','source_time_entry_id',
  'source_time_entry_version','employee_code','employee_display_name','worksite_id',
  'worksite_name','started_at_utc','ended_at_utc','started_at_brussels',
  'ended_at_brussels','duration_microseconds','factual_origin','last_correction_request_id'
]);
select columns_are('private', 'time_export_creation_operations', array[
  'request_id','organization_id','manager_membership_id','payload_hash','result_code',
  'export_id','processed_at'
]);
select indexes_are('public', 'time_exports', array[
  'time_exports_pkey','time_exports_organization_id_id_key',
  'time_exports_organization_created_at_idx','time_exports_worksite_period_idx'
]);
select indexes_are('private', 'time_export_rows', array[
  'time_export_rows_pkey','time_export_rows_source_version_key',
  'time_export_rows_organization_idx'
]);
select indexes_are('private', 'time_export_creation_operations', array[
  'time_export_creation_operations_pkey','time_export_creation_operations_manager_idx',
  'time_export_creation_operations_export_idx'
]);
select ok((select relrowsecurity from pg_class where oid = 'public.time_exports'::regclass), 'metadata RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'private.time_export_rows'::regclass), 'snapshot RLS enabled');
select ok((select relrowsecurity from pg_class where oid = 'private.time_export_creation_operations'::regclass), 'operation RLS enabled');
select is((select count(*) from pg_policies where schemaname = 'private'
  and tablename in ('time_export_rows','time_export_creation_operations')), 0::bigint,
  'private export tables have no policies');
select ok(not has_table_privilege(role_name, table_name,
  'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'),
  role_name || ' has no private access to ' || table_name)
from unnest(array['anon','authenticated','service_role']) role_name,
  unnest(array['private.time_export_rows','private.time_export_creation_operations']) table_name;
select ok(not has_table_privilege('authenticated', 'public.time_exports',
  'INSERT,UPDATE,DELETE,TRUNCATE'), 'browser has no metadata writes');
select ok(p.proowner = 'postgres'::regrole and p.prosecdef = expected.definer
  and p.proconfig = array['search_path=""']
  and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
    from aclexplode(p.proacl) a) = array['authenticated','postgres'],
  expected.signature || ' exact owner, path, security, grants')
from (values
  ('private.preview_time_export(text,text)', true),
  ('public.preview_time_export(text,text)', false),
  ('private.create_time_export(uuid,text,text,boolean)', true),
  ('public.create_time_export(uuid,text,text,boolean)', false),
  ('private.get_manager_time_exports()', true),
  ('public.get_manager_time_exports()', false),
  ('private.get_time_export_snapshot(uuid)', true),
  ('public.get_time_export_snapshot(uuid)', false)
) expected(signature, definer)
join pg_proc p on p.oid = expected.signature::regprocedure;
select is((select pronargs::integer from pg_proc
  where oid = 'public.create_time_export(uuid,text,text,boolean)'::regprocedure), 4,
  'creation accepts only operation UUID, dates, and confirmation');

-- Independent read/action authorization and cross-tenant RLS.
set local role authenticated;
select pg_temp.export_login(2);
select is((select count(*) from public.time_exports), 0::bigint, 'employee sees no metadata');
select throws_ok($$select public.preview_time_export('2010-01-01','2010-01-01')$$,
  '42501', null, 'employee preview denied');
select throws_ok($$select * from public.create_time_export(gen_random_uuid(),'2010-01-01','2010-01-01',true)$$,
  '42501', null, 'employee creation denied');
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'employee history denied');
select throws_ok($$select public.get_time_export_snapshot(gen_random_uuid())$$, '42501', null, 'employee download denied');

select pg_temp.export_login(4);
select throws_ok($$select public.preview_time_export('2010-01-01','2010-01-01')$$, '42501', null, 'inactive manager denied');
select pg_temp.export_login(5);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'suspended manager denied');
select pg_temp.export_login(6);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'expired session denied');
select pg_temp.export_login(7);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'banned manager denied');
select pg_temp.export_login(8);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'deleted manager denied');
select pg_temp.export_login(9);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'unverified manager denied');
select pg_temp.export_login(10);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'ambiguous membership denied');
select pg_temp.export_login(1);
select set_config('request.jwt.claims', (auth.jwt() || '{"exp":1}')::text, true);
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'expired JWT denied');
set local "request.jwt.claims" = '{}';
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'sessionless caller denied');
set local role anon;
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'anonymous denied');
set local role service_role;
select throws_ok($$select public.get_manager_time_exports()$$, '42501', null, 'service role denied');

-- Brussels half-open boundaries, overnight allocation, DST, warnings, and no duplicates.
set local role authenticated;
select pg_temp.export_login(1);
select is((public.preview_time_export('2010-01-01','2010-01-01')->>'record_count')::integer,
  2, 'Jan 1 selects two local-start facts including overnight entry');
select is((public.preview_time_export('2010-01-02','2010-01-02')->>'record_count')::integer,
  1, 'adjacent Jan 2 excludes Jan 1 overnight entry');
select is(public.preview_time_export('2010-03-28','2010-03-28')->>'utc_start_inclusive',
  '2010-03-27T23:00:00.000000Z', 'spring-forward starts at correct UTC midnight');
select is(public.preview_time_export('2010-03-28','2010-03-28')->>'utc_end_exclusive',
  '2010-03-28T22:00:00.000000Z', 'spring-forward day has 23-hour UTC window');
select is(public.preview_time_export('2010-10-31','2010-10-31')->>'utc_end_exclusive',
  '2010-10-31T23:00:00.000000Z', 'autumn-repeat day has 25-hour UTC window');
select is(public.preview_time_export('2010-10-31','2010-10-31')->>'total_duration_microseconds',
  '7200000001', 'autumn repeated hour preserves exact elapsed microseconds');
select ok((public.preview_time_export('2010-01-01','2010-01-01')->'warnings') ?&
  array['missing_employee_code','missing_display_name'], 'missing optional identity fields warn explicitly');
select lives_ok($$select public.preview_time_export('2010-01-01','2010-01-31')$$,
  'inclusive 31-day range accepted');
select throws_ok($$select public.preview_time_export('2010-01-01','2010-02-01')$$,
  '22023', 'export_invalid_period', '32-day range rejected');
select throws_ok($$select public.preview_time_export('','2010-01-01')$$,
  '22023', 'export_invalid_period', 'empty date rejected');
select throws_ok($$select public.preview_time_export('2010-02-30','2010-03-01')$$,
  '22023', 'export_invalid_period', 'invalid date rejected');
select throws_ok($$select public.preview_time_export('2100-01-01','2100-01-01')$$,
  '22023', 'export_invalid_period', 'future end rejected');
select ok((public.preview_time_export('2010-01-10','2010-01-10')->'blockers') ? 'no_records',
  'period without facts is blocked');

-- Terminal corrections do not block; pending target/proposals and open facts do.
reset role;
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, target_time_entry_id,
  request_kind, proposed_started_at, proposed_ended_at, original_started_at,
  original_ended_at, original_time_entry_version, employee_reason, submission_request_id,
  status, resolved_at, resolved_by_membership_id, resolution_request_id, manager_note
) values (
  pg_temp.export_id(907, 2), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2),
  pg_temp.export_id(904, 1), pg_temp.export_id(906, 2), 'adjustment',
  '2010-01-02 07:05Z', '2010-01-02 08:00Z', '2010-01-02 07:00Z',
  '2010-01-02 08:00Z', 1, 'Fictieve afwijzing', pg_temp.export_id(908, 2),
  'rejected', now(), pg_temp.export_id(905, 1), pg_temp.export_id(909, 2), 'Niet toepassen'
);
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, request_kind,
  proposed_started_at, proposed_ended_at, employee_reason, submission_request_id,
  status, withdrawal_request_id, withdrawn_at
) values (
  pg_temp.export_id(907, 3), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2),
  pg_temp.export_id(904, 1), 'missed_entry', '2010-01-06 08:00Z', '2010-01-06 09:00Z',
  'Fictief ingetrokken', pg_temp.export_id(908, 3), 'withdrawn',
  pg_temp.export_id(909, 3), now()
);
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, target_time_entry_id,
  request_kind, proposed_started_at, proposed_ended_at, original_started_at,
  original_ended_at, original_time_entry_version, employee_reason, submission_request_id
) values (
  pg_temp.export_id(907, 4), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2),
  pg_temp.export_id(904, 1), pg_temp.export_id(906, 2), 'adjustment',
  '2010-01-08 07:00Z', '2010-01-08 08:00Z', '2010-01-02 07:00Z',
  '2010-01-02 08:00Z', 1, 'Fictief doelblok', pg_temp.export_id(908, 4)
), (
  pg_temp.export_id(907, 5), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2),
  pg_temp.export_id(904, 1), null, 'missed_entry',
  '2010-01-03 07:00Z', '2010-01-03 08:00Z', null, null, null,
  'Fictief periodeblok', pg_temp.export_id(908, 5)
);
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at
) values (
  pg_temp.export_id(906, 6), pg_temp.export_id(903, 1), pg_temp.export_id(905, 2),
  pg_temp.export_id(904, 1), '2010-01-04 07:00Z', null
);
set local role authenticated;
select pg_temp.export_login(1);
select ok((public.preview_time_export('2010-01-02','2010-01-02')->'blockers') ? 'pending_correction',
  'pending adjustment target blocks selected factual entry despite outside proposal');
select ok((public.preview_time_export('2010-01-03','2010-01-03')->'blockers') ? 'pending_correction',
  'pending missed-entry proposal overlap blocks period');
select ok((public.preview_time_export('2010-01-04','2010-01-04')->'blockers') ? 'open_entry',
  'open overlapping entry blocks period');
select ok(not (public.preview_time_export('2010-01-06','2010-01-06')->'blockers') ? 'pending_correction',
  'withdrawn proposal does not block');

-- Atomic creation, exact current version, canonical metadata, retry, and audit.
select is((select result_code from public.create_time_export(
  pg_temp.export_id(910, 1), '2010-01-01', '2010-01-01', true
)), 'created', 'manager confirms first snapshot');
select is((select export_id from public.create_time_export(
  pg_temp.export_id(910, 1), '2010-01-01', '2010-01-01', true
)), (select id from public.time_exports order by created_at limit 1),
  'identical retry returns original export ID');
select throws_ok($$select * from public.create_time_export(
  pg_temp.export_id(910,1),'2010-01-01','2010-01-02',true)$$,
  '22023', 'export_request_id_reused', 'altered period reuse fails closed');
select throws_ok($$select * from public.create_time_export(
  pg_temp.export_id(910,1),'2010-01-01','2010-01-01',false)$$,
  '42501', 'Export kan niet worden bevestigd.', 'changed confirmation cannot reuse operation');
select is((select count(*) from public.time_exports), 1::bigint, 'retry creates one metadata row');
select is((select count(*) from public.audit_events where action = 'time_export.created'),
  1::bigint, 'retry creates exactly one export audit');
reset role;
select is((select count(*) from private.time_export_creation_operations
  where request_id = pg_temp.export_id(910, 1)), 1::bigint, 'retry creates one operation outcome');
select ok((select schema_version = 'cloxa.time-export.v1'
    and selection_rule = 'brussels-start-date.v1'
    and timezone = 'Europe/Brussels'
    and record_count = 2 and employee_count = 2
    and total_duration_microseconds = 11700000000
    and dataset_sha256 ~ '^[0-9a-f]{64}$'
  from public.time_exports limit 1), 'manifest stores exact v1 summary and canonical hash');
select is((select count(*) from private.time_export_rows), 2::bigint, 'snapshot contains exact two rows');
select ok((select source_time_entry_version = 2
    and last_correction_request_id = pg_temp.export_id(907,1)
    and started_at_utc = '2010-01-01T22:45:00.123456Z'
    and started_at_brussels = '2010-01-01T23:45:00.123456+01:00'
    and ended_at_brussels = '2010-01-02T02:00:00.123456+01:00'
  from private.time_export_rows where row_ordinal = 1),
  'snapshot captures exact corrected version, UTC/local offsets, and reference');
select ok((select employee_code is null and employee_display_name is null
  from private.time_export_rows where row_ordinal = 2),
  'missing optional identity remains null');
select ok((select after_data ?& array[
    'schema_version','period_start_local','period_end_local','record_count',
    'employee_count','total_duration_microseconds','dataset_sha256','selection_rule'
  ] and not after_data ?| array[
    'employee_code','employee_display_name','started_at','ended_at','reason','manager_note','email'
  ] from public.audit_events where action = 'time_export.created'),
  'creation audit contains safe manifest summary and no PII/free text');

-- Old snapshot survives profile/code/worksite/fact/member changes and new facts.
select set_config('test.export_id', (select id::text from public.time_exports limit 1), true);
update public.profiles set display_name = 'Gewijzigde fictieve naam'
  where user_id = pg_temp.export_id(901, 2);
update public.memberships set employee_code = 'SYN-NEW', status = 'inactive'
  where id = pg_temp.export_id(905, 2);
update public.worksites set name = 'Gewijzigde werkplek' where id = pg_temp.export_id(904, 1);
update public.time_entries set started_at = started_at + interval '1 minute'
  where id = pg_temp.export_id(906, 1);
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at
) values (
  pg_temp.export_id(906, 7), pg_temp.export_id(903, 1), pg_temp.export_id(905, 11),
  pg_temp.export_id(904, 1), '2010-01-01 10:00Z', '2010-01-01 10:30Z'
);
select ok((select employee_code = ' =SYN,"1"'
    and employee_display_name = ' =SOM(1); "Élodie"'
    and worksite_name = 'Werkplek; "Noord"'
    and source_time_entry_version = 2
    and started_at_utc = '2010-01-01T22:45:00.123456Z'
  from private.time_export_rows where row_ordinal = 1),
  'later identity, worksite, membership, and factual changes do not rewrite old row');
select is((select record_count from public.time_exports limit 1), 2,
  'new fact does not change old manifest');

-- Current manager can still download; copied UUIDs and other tenants cannot.
set local role authenticated;
select pg_temp.export_login(1);
select is((public.get_time_export_snapshot((select id from public.time_exports limit 1))
  ->'manifest'->>'record_count')::integer, 2, 'current manager reauthorizes old snapshot download');
select is(jsonb_array_length(public.get_time_export_snapshot(
  (select id from public.time_exports limit 1))->'records'), 2,
  'download returns exact stored row count');
select is(jsonb_array_length(public.get_manager_time_exports()->'exports'), 1,
  'history returns confirmed snapshot');
select pg_temp.export_login(3);
select is((select count(*) from public.time_exports), 0::bigint,
  'other tenant manager cannot read metadata');
select throws_ok($$select public.get_time_export_snapshot(
  current_setting('test.export_id')::uuid)$$, '42501', null,
  'other tenant manager cannot use copied export UUID');
select throws_ok($$select * from public.create_time_export(
  pg_temp.export_id(910,1),'2010-01-01','2010-01-01',true)$$,
  '22023', 'export_request_id_reused', 'another manager cannot reuse global operation UUID');
select pg_temp.export_login(1);

-- Safe blocker outcomes are durable and create no metadata/audit.
select is((select result_code from public.create_time_export(
  pg_temp.export_id(910,2),'2010-01-04','2010-01-04',true)), 'open_entry',
  'open entry creates durable blocker outcome');
select is((select result_code from public.create_time_export(
  pg_temp.export_id(910,2),'2010-01-04','2010-01-04',true)), 'open_entry',
  'open blocker retry replays');
select is((select count(*) from public.time_exports), 1::bigint,
  'blocked creation creates no metadata');
select is((select count(*) from public.audit_events where action = 'time_export.created'),
  1::bigint, 'blocked creation creates no audit');
reset role;
update public.time_entries set ended_at = '2010-01-04 08:00Z'
where id = pg_temp.export_id(906, 6);

-- Owner-side mutation guards cover rows, metadata, ledgers, and TRUNCATE.
select throws_ok($$update public.time_exports set record_count = record_count + 1$$,
  '55000', 'time_export_snapshot_fixed', 'metadata update rejected');
select throws_ok($$delete from public.time_exports$$,
  '55000', 'time_export_snapshot_fixed', 'metadata delete rejected');
select throws_ok($$truncate public.time_exports cascade$$,
  '55000', 'time_export_snapshot_fixed', 'metadata truncate rejected');
select throws_ok($$update private.time_export_rows set employee_code = 'changed'$$,
  '55000', 'time_export_snapshot_fixed', 'snapshot update rejected');
select throws_ok($$delete from private.time_export_rows$$,
  '55000', 'time_export_snapshot_fixed', 'snapshot delete rejected');
select throws_ok($$truncate private.time_export_rows$$,
  '55000', 'time_export_snapshot_fixed', 'snapshot truncate rejected');
select throws_ok($$update private.time_export_creation_operations set result_code = 'no_records'$$,
  '55000', 'time_export_snapshot_fixed', 'ledger update rejected');
select throws_ok($$delete from private.time_export_creation_operations$$,
  '55000', 'time_export_snapshot_fixed', 'ledger delete rejected');
select throws_ok($$truncate private.time_export_creation_operations$$,
  '55000', 'time_export_snapshot_fixed', 'ledger truncate rejected');

-- Injected snapshot and audit failures roll back metadata, rows, ledgers, and audit.
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at
) values (
  pg_temp.export_id(906, 8), pg_temp.export_id(903, 1), pg_temp.export_id(905, 11),
  pg_temp.export_id(904, 1), '2013-01-01 08:00Z', '2013-01-01 09:00Z'
);
create function pg_temp.fail_export_snapshot() returns trigger language plpgsql as $$
begin raise exception 'synthetic_snapshot_failure'; end $$;
create trigger synthetic_snapshot_failure before insert on private.time_export_rows
for each row execute function pg_temp.fail_export_snapshot();
set local role authenticated;
select pg_temp.export_login(1);
select throws_ok($$select * from public.create_time_export(
  pg_temp.export_id(910,3),'2013-01-01','2013-01-01',true)$$,
  'P0001', 'synthetic_snapshot_failure', 'injected snapshot failure denies creation');
reset role;
drop trigger synthetic_snapshot_failure on private.time_export_rows;
select is((select count(*) from public.time_exports where period_start_local = '2013-01-01'),
  0::bigint, 'snapshot failure leaves no metadata');
select is((select count(*) from private.time_export_creation_operations
  where request_id = pg_temp.export_id(910,3)), 0::bigint, 'snapshot failure leaves no ledger');

create function pg_temp.fail_export_audit() returns trigger language plpgsql as $$
begin if new.action = 'time_export.created' then raise exception 'synthetic_audit_failure'; end if; return new; end $$;
create trigger synthetic_audit_failure before insert on public.audit_events
for each row execute function pg_temp.fail_export_audit();
set local role authenticated;
select pg_temp.export_login(1);
select throws_ok($$select * from public.create_time_export(
  pg_temp.export_id(910,4),'2013-01-01','2013-01-01',true)$$,
  'P0001', 'synthetic_audit_failure', 'injected audit failure denies creation');
reset role;
drop trigger synthetic_audit_failure on public.audit_events;
select is((select count(*) from public.time_exports where period_start_local = '2013-01-01'),
  0::bigint, 'audit failure rolls back metadata and snapshot');
select is((select count(*) from private.time_export_creation_operations
  where request_id = pg_temp.export_id(910,4)), 0::bigint, 'audit failure leaves no ledger');

-- Row and conservative artifact-size limits fail before snapshot creation.
insert into public.time_entries (
  organization_id, membership_id, worksite_id, started_at, ended_at
)
select pg_temp.export_id(903,1), pg_temp.export_id(905,11), pg_temp.export_id(904,1),
  '2011-01-01 08:00Z'::timestamptz + n * interval '2 microseconds',
  '2011-01-01 08:00Z'::timestamptz + n * interval '2 microseconds' + interval '1 microsecond'
from generate_series(1,10001) n;
set local role authenticated;
select pg_temp.export_login(1);
select ok((public.preview_time_export('2011-01-01','2011-01-01')->'blockers') ? 'row_limit',
  'preview exposes 10,000-row bound');
select is((select result_code from public.create_time_export(
  pg_temp.export_id(910,5),'2011-01-01','2011-01-01',true)), 'row_limit',
  'creation enforces 10,000-row bound');
reset role;
update public.profiles set display_name = repeat('x', 1800000)
  where user_id = pg_temp.export_id(901,12);
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at
) values (
  pg_temp.export_id(906, 9), pg_temp.export_id(903, 1), pg_temp.export_id(905, 12),
  pg_temp.export_id(904, 1), '2012-01-01 08:00Z', '2012-01-01 09:00Z'
);
set local role authenticated;
select pg_temp.export_login(1);
select ok((public.preview_time_export('2012-01-01','2012-01-01')->'blockers') ? 'artifact_too_large',
  'preview exposes conservative 10 MiB artifact bound');
select is((select result_code from public.create_time_export(
  pg_temp.export_id(910,6),'2012-01-01','2012-01-01',true)), 'artifact_too_large',
  'creation enforces conservative artifact bound');

-- Full endpoint-denial matrix uses an existing copied UUID, not an RLS-hidden lookup.
reset role;
insert into auth.sessions (id, user_id, created_at, updated_at)
values (pg_temp.export_id(902,5), pg_temp.export_id(901,5), now(), now());
create function pg_temp.assert_export_denied(fixture integer) returns setof text
language plpgsql as $$
begin
  perform pg_temp.export_login(fixture);
  return next throws_ok($sql$select public.preview_time_export('2010-01-01','2010-01-01')$sql$,
    '42501', null, 'unsupported caller ' || fixture || ' preview denied');
  return next throws_ok($sql$select * from public.create_time_export(gen_random_uuid(),'2010-01-01','2010-01-01',true)$sql$,
    '42501', null, 'unsupported caller ' || fixture || ' creation denied');
  return next throws_ok($sql$select public.get_manager_time_exports()$sql$,
    '42501', null, 'unsupported caller ' || fixture || ' history denied');
  return next throws_ok($sql$select public.get_time_export_snapshot(current_setting('test.export_id')::uuid)$sql$,
    '42501', null, 'unsupported caller ' || fixture || ' copied download denied');
  if current_setting('role') = 'authenticated' then
    return next is((select count(*) from public.time_exports), 0::bigint,
      'unsupported caller ' || fixture || ' metadata denied');
  else
    return next throws_ok('select count(*) from public.time_exports', '42501', null,
      'unsupported role metadata denied');
  end if;
end $$;
set local role authenticated;
select pg_temp.assert_export_denied(n) from unnest(array[2,4,5,6,7,8,9,10]) n;
reset role;
delete from auth.sessions where id = pg_temp.export_id(902,1);
set local role authenticated;
select pg_temp.assert_export_denied(1);
reset role;
insert into auth.sessions (id,user_id,created_at,updated_at)
values (pg_temp.export_id(902,1), pg_temp.export_id(901,1), now(), now());
set local role service_role;
select pg_temp.assert_export_denied(1);
set local role anon;
-- Metadata lacks even SELECT privilege for anon/service; test RPCs separately.
select throws_ok($$select public.preview_time_export('2010-01-01','2010-01-01')$$, '42501', null, 'anon preview denied');
select throws_ok($$select * from public.create_time_export(gen_random_uuid(),'2010-01-01','2010-01-01',true)$$, '42501', null, 'anon creation denied');
select throws_ok($$select public.get_time_export_snapshot(current_setting('test.export_id')::uuid)$$, '42501', null, 'anon copied download denied');
reset role;

-- Helper exposure, table ownership, exact constraint sets, and sole-worksite reads.
select ok(c.relowner = 'postgres'::regrole, c.oid::regclass || ' owner is postgres')
from pg_class c where c.oid in ('public.time_exports'::regclass,
  'private.time_export_rows'::regclass,'private.time_export_creation_operations'::regclass);
select ok(not has_function_privilege(role_name,
  'private.selected_time_export_records(uuid,uuid,timestamptz,timestamptz)', 'EXECUTE'),
  role_name || ' cannot invoke raw selection helper')
from unnest(array['anon','authenticated','service_role']) role_name;
select results_eq($$select conname::text collate "C" from pg_constraint where conrelid = 'public.time_exports'::regclass order by conname$$,
  $$select unnest(array['time_exports_duration_check','time_exports_employee_count_check',
    'time_exports_hash_check','time_exports_organization_id_fkey','time_exports_organization_id_id_key',
    'time_exports_period_check','time_exports_pkey','time_exports_record_count_check',
    'time_exports_schema_version_check','time_exports_selection_rule_check',
    'time_exports_timezone_check','time_exports_worksite_fkey']) collate "C"$$, 'exact metadata constraints');
select results_eq($$select conname::text collate "C" from pg_constraint where conrelid = 'private.time_export_rows'::regclass order by conname$$,
  $$select unnest(array['time_export_rows_duration_check','time_export_rows_export_fkey',
    'time_export_rows_ordinal_check','time_export_rows_origin_check','time_export_rows_pkey',
    'time_export_rows_version_check','time_export_rows_worksite_fkey']) collate "C"$$, 'exact snapshot constraints');
select results_eq($$select conname::text collate "C" from pg_constraint where conrelid = 'private.time_export_creation_operations'::regclass order by conname$$,
  $$select unnest(array['time_export_creation_operations_pkey','time_export_operations_export_fkey',
    'time_export_operations_hash_check','time_export_operations_manager_fkey','time_export_operations_result_check']) collate "C"$$,
  'exact operation constraints');
insert into public.worksites(id,organization_id,name)
values(pg_temp.export_id(904,10), pg_temp.export_id(903,1), 'Tweede fictieve werkplek');
set local role authenticated;
select pg_temp.export_login(1);
select throws_ok($$select public.get_time_export_snapshot(current_setting('test.export_id')::uuid)$$,
  '42501', null, 'multi-worksite download denied');
select throws_ok($$select public.preview_time_export('2010-01-01','2010-01-01')$$,
  '55000', null, 'multi-worksite preview denied');
select throws_ok($$select public.get_manager_time_exports()$$,
  '55000', null, 'multi-worksite history denied');
select throws_ok($$select * from public.create_time_export(gen_random_uuid(),'2010-01-01','2010-01-01',true)$$,
  '42501', null, 'multi-worksite creation denied');
select is((select count(*) from public.time_exports),0::bigint,'multi-worksite metadata denied');
reset role;
delete from public.worksites where id = pg_temp.export_id(904,10);

-- Approved missed-entry facts export; pending/rejected proposals never become facts.
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, request_kind,
  proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
) values (pg_temp.export_id(907,40), pg_temp.export_id(903,1),pg_temp.export_id(905,11),
  pg_temp.export_id(904,1),'missed_entry','2016-02-01 08:00Z','2016-02-01 09:00Z',
  'Fictief ontbrekend interval', pg_temp.export_id(908,40));
set local role authenticated;
select pg_temp.export_login(1);
select is((select result_code from public.decide_correction_request(
  pg_temp.export_id(909,40),pg_temp.export_id(907,40),'approve','')), 'approved', 'missed entry approved');
select is((select result_code from public.create_time_export(
  pg_temp.export_id(910,40),'2016-02-01','2016-02-01',true)), 'created', 'approved missed-entry snapshot created');
select is((public.get_time_export_snapshot((select id from public.time_exports where period_start_local='2016-02-01'))
  ->'records'->0->>'factual_origin'), 'approved_missed_entry', 'approved missed-entry origin retained');
select ok((with snapshot as (select public.get_time_export_snapshot(current_setting('test.export_id')::uuid) as data)
  select encode(sha256(convert_to(jsonb_build_object('manifest',(data->'manifest')-'dataset_sha256',
    'records',data->'records')::text,'UTF8')),'hex') = data->'manifest'->>'dataset_sha256' from snapshot),
  'stored dataset hash recomputes from manifest without self-hash and ordered stored rows');
reset role;
select is(private.format_export_brussels('1880-01-01 12:00Z'::timestamptz),
  '1880-01-01T12:17:30.000000+00:17:30', 'historical second-resolution Brussels offset remains exact');

select * from finish();
rollback;
