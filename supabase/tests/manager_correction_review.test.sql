begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

create function pg_temp.fixture_id(prefix integer, number integer) returns uuid
language sql immutable as $$ select (prefix::text || '00000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid $$;
create function pg_temp.login(number integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', pg_temp.fixture_id(111, number),
    'role', 'authenticated', 'session_id', pg_temp.fixture_id(112, number), 'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint)))::text, true)::text::void;
$$;
insert into auth.users (id, email, email_confirmed_at, encrypted_password, banned_until, deleted_at)
select pg_temp.fixture_id(111, n), 'decision.fixture.' || n || '@example.test',
  case when n = 6 then null else now() - interval '1 day' end, 'synthetic-not-a-password',
  case when n = 11 then now() + interval '1 day' end,
  case when n = 12 then now() end from generate_series(1, 13) as n;
insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select pg_temp.fixture_id(112, n), pg_temp.fixture_id(111, n), now(), now(),
  case when n = 10 then now() - interval '1 second' end
from generate_series(1, 13) as n where n <> 9;
insert into public.organizations (id, name, lifecycle_status)
select pg_temp.fixture_id(113, n), 'Synthetic review tenant ' || n,
  case when n = 3 then 'suspended' else 'research_pilot' end from generate_series(1, 3) as n;
insert into public.worksites (id, organization_id, name)
select pg_temp.fixture_id(114, n), pg_temp.fixture_id(113, n), 'Synthetic worksite ' || n from generate_series(1, 3) as n;
insert into public.memberships (id, organization_id, user_id, role, status, employee_code)
select pg_temp.fixture_id(115, n), pg_temp.fixture_id(113, case when n in (3, 4) then 2 when n = 7 then 3 else 1 end),
  pg_temp.fixture_id(111, n), case when n in (1, 3) then 'employee' else 'manager' end,
  case when n = 5 then 'inactive' else 'active' end, 'SYN-' || n
from generate_series(1, 12) as n;
insert into public.memberships (id, organization_id, user_id, role, status)
values (pg_temp.fixture_id(115, 20), pg_temp.fixture_id(113, 3), pg_temp.fixture_id(111, 8), 'manager', 'active');

insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at)
select gen_random_uuid(),m.user_id,'Synthetic manager TOTP','totp','verified',now(),now()
from (select distinct user_id from public.memberships where role='manager'
  and user_id::text like '11100000-0000-4000-8000-%') m
where exists(select 1 from auth.sessions s where s.user_id=m.user_id);
update auth.sessions s set factor_id=f.id,aal='aal2' from auth.mfa_factors f
where f.user_id=s.user_id and f.factor_type='totp'
  and s.user_id::text like '11100000-0000-4000-8000-%';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),s.id,now(),now(),'totp' from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id
where s.user_id::text like '11100000-0000-4000-8000-%';
insert into private.manager_mfa_registrations(auth_user_id,provider_factor_id)
select user_id,id from auth.mfa_factors where factor_type='totp'
  and user_id::text like '11100000-0000-4000-8000-%';
insert into public.profiles (user_id, display_name)
select pg_temp.fixture_id(111, n), 'Fictieve medewerker ' || n from generate_series(1, 13) as n;

insert into public.time_entries (id, organization_id, membership_id, worksite_id, started_at, ended_at)
select pg_temp.fixture_id(116, n), pg_temp.fixture_id(113, 1), pg_temp.fixture_id(115, 1), pg_temp.fixture_id(114, 1),
  '2010-01-01 08:00Z'::timestamptz + (n - 1) * interval '1 day',
  '2010-01-01 10:00Z'::timestamptz + (n - 1) * interval '1 day'
from unnest(array[1, 3, 4, 5, 6, 10]) as n;
insert into public.correction_requests (id, organization_id, employee_membership_id, worksite_id,
  target_time_entry_id, request_kind, proposed_started_at, proposed_ended_at,
  original_started_at, original_ended_at, original_time_entry_version,
  employee_reason, submission_request_id)
select pg_temp.fixture_id(117, n), pg_temp.fixture_id(113, 1), pg_temp.fixture_id(115, 1), pg_temp.fixture_id(114, 1),
  case when n in (1, 3, 4, 6, 10) then pg_temp.fixture_id(116, n) end,
  case when n in (1, 3, 4, 6, 10) then 'adjustment' else 'missed_entry' end,
  '2010-01-01 08:15:00.123456Z'::timestamptz + (n - 1) * interval '1 day',
  '2010-01-01 10:00:00.654321Z'::timestamptz + (n - 1) * interval '1 day',
  case when n in (1, 3, 4, 6, 10) then '2010-01-01 08:00Z'::timestamptz + (n - 1) * interval '1 day' end,
  case when n in (1, 3, 4, 6, 10) then '2010-01-01 10:00Z'::timestamptz + (n - 1) * interval '1 day' end,
  case when n in (1, 3, 4, 6, 10) then 1 end,
  'synthetic <b>employee claim</b>', gen_random_uuid() from generate_series(1, 10) as n;
insert into public.correction_requests (id, organization_id, employee_membership_id, worksite_id,
  request_kind, proposed_started_at, proposed_ended_at, employee_reason, submission_request_id)
values (pg_temp.fixture_id(117, 13), pg_temp.fixture_id(113, 2), pg_temp.fixture_id(115, 3), pg_temp.fixture_id(114, 2),
  'missed_entry', '2010-02-01 08:00Z', '2010-02-01 10:00Z', 'other tenant claim', gen_random_uuid()),
  (pg_temp.fixture_id(117, 14), pg_temp.fixture_id(113, 1), pg_temp.fixture_id(115, 1), pg_temp.fixture_id(114, 1),
  'missed_entry', '2100-01-01 08:00Z', '2100-01-01 10:00Z', 'future defensive fixture', gen_random_uuid());

select columns_are('private', 'manager_decision_operations', array['request_id','organization_id','manager_membership_id',
  'employee_membership_id','correction_request_id','decision','payload_hash','result_code','request_status','did_decide','time_entry_id','processed_at']);
select indexes_are('private', 'manager_decision_operations', array['manager_decision_operations_pkey',
  'manager_decision_operations_manager_idx','manager_decision_operations_request_idx','manager_decision_operations_entry_idx']);
select ok((select relrowsecurity from pg_class where oid = 'private.manager_decision_operations'::regclass), 'decision ledger has RLS');
select is((select count(*) from pg_policies where schemaname = 'private' and tablename = 'manager_decision_operations'), 0::bigint, 'private ledger has no browser policies');
select ok(not has_table_privilege(role_name, 'private.manager_decision_operations', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'), role_name || ' has no ledger privileges')
from unnest(array['anon','authenticated','service_role']) as role_name;
select ok(not has_table_privilege('authenticated', table_name, 'INSERT,UPDATE,DELETE,TRUNCATE'), table_name || ' has no direct browser writes')
from unnest(array['public.time_entries','public.correction_requests','public.audit_events']) as table_name;
select ok(not has_column_privilege('authenticated', 'public.correction_requests', column_name, 'SELECT'), column_name || ' hidden from browser readers')
from unnest(array['resolved_by_membership_id','resolution_request_id','original_time_entry_version']) as column_name;
select ok(p.proowner = 'postgres'::regrole and p.prosecdef = expected.definer and p.proconfig = array['search_path=""']
  and (select array_agg(a.grantee::regrole::text order by a.grantee::regrole::text)
    from aclexplode(p.proacl) a) = array['authenticated','postgres'], expected.signature || ' exact owner, path, security, grants')
from (values ('private.manager_review_organization()', true),
  ('private.decide_correction_request(uuid,uuid,text,text)', true), ('public.decide_correction_request(uuid,uuid,text,text)', false),
  ('private.get_manager_correction_requests()', true), ('public.get_manager_correction_requests()', false)) expected(signature, definer)
join pg_proc p on p.oid = expected.signature::regprocedure;
select is((select pronargs::integer from pg_proc where oid = 'public.decide_correction_request(uuid,uuid,text,text)'::regprocedure), 4, 'browser submits only four decision fields');
select is((select version from public.time_entries where id = pg_temp.fixture_id(116, 1)), 1, 'legacy rows have safe version default');
select is((select origin from public.time_entries where id = pg_temp.fixture_id(116, 1)), 'clock', 'legacy rows keep clock origin');
select col_type_is('public', 'correction_requests', 'original_time_entry_version', 'integer',
  'factual version snapshot uses integer');
select ok((select convalidated from pg_constraint
    where conrelid = 'public.correction_requests'::regclass
      and conname = 'correction_requests_original_version_snapshot_check'),
  'factual version snapshot constraint is validated');

set local role authenticated;
select pg_temp.login(2);
select is((select count(*) from public.correction_requests), 11::bigint, 'manager reads only own tenant requests');
select is((select count(*) from public.time_entries), 6::bigint, 'manager reads only own tenant factual entries');
select is((public.get_manager_correction_requests()->>'pending_count')::integer, 11, 'queue counts all own pending requests');
select ok((public.get_manager_correction_requests()->'requests'->0) ?& array['employee_display_name','employee_code','original_started_at','original_ended_at','employee_reason'], 'queue carries required detail');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117, 13), 'approve', '')$$, '42501', null, 'manager cannot decide cross-tenant request');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117, 3), 'reject', E' \t\n')$$, '22023', 'decision_note_required', 'rejection requires trimmed explanation');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117, 3), 'reject', repeat('x',501))$$, '22023', 'decision_invalid_request', 'manager note bounded');
select throws_ok($$update public.time_entries set ended_at = now()$$, '42501', null, 'manager cannot mutate facts directly');
select throws_ok($$update public.correction_requests set status = 'approved'$$, '42501', null, 'manager cannot decide through table');
select throws_ok($$insert into private.manager_decision_operations(request_id) values(gen_random_uuid())$$, '42501', null, 'browser cannot write decision ledger');

-- Live Auth and role denials. Includes active membership in a suspended second tenant.
select pg_temp.login(1);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 1');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 1');
select pg_temp.login(3);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 3');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 3');
select pg_temp.login(5);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 5');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 5');
select pg_temp.login(6);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 6');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 6');
select pg_temp.login(7);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 7');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 7');
select pg_temp.login(8);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 8');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 8');
select pg_temp.login(9);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 9');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 9');
select pg_temp.login(10);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 10');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 10');
select pg_temp.login(11);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 11');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 11');
select pg_temp.login(12);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 12');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 12');
select pg_temp.login(13);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'queue denies actor 13');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'decision denies actor 13');
select pg_temp.login(4);
select is((select count(*) from public.correction_requests), 1::bigint, 'second manager sees own tenant only');
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'reject', 'cross tenant')$$, '42501', null, 'second manager cannot reject first tenant');
select pg_temp.login(2);
set local "request.jwt.claims" = '{"sub":"11100000-0000-4000-8000-000000000002","role":"service_role","session_id":"11200000-0000-4000-8000-000000000002"}';
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'authenticated SQL role with service-role impersonation claims fails');
select pg_temp.login(2);
select set_config('request.jwt.claims', (auth.jwt() || '{"exp":1}')::text, true);
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'expired JWT fails review helper');
select pg_temp.login(2);
set local role service_role;
select throws_ok($$select * from public.decide_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,1), 'approve', '')$$, '42501', null, 'service role cannot impersonate manager RPC');
set local role anon;
select throws_ok($$select public.get_manager_correction_requests()$$, '42501', null, 'anonymous has no review RPC');
set local role authenticated;
select pg_temp.login(2);

-- Exact adjustment approval, immutable snapshot, and same-operation replay.
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,1), pg_temp.fixture_id(117,1), 'approve', '  synthetic manager note  ')), 'approved', 'adjustment approved');
select is((select started_at from public.time_entries where id = pg_temp.fixture_id(116,1)), '2010-01-01 08:15:00.123456Z'::timestamptz, 'exact microsecond proposed start applied');
select is((select ended_at from public.time_entries where id = pg_temp.fixture_id(116,1)), '2010-01-01 10:00:00.654321Z'::timestamptz, 'exact microsecond proposed end applied');
select is((select version from public.time_entries where id = pg_temp.fixture_id(116,1)), 2, 'factual version increments once');
select is((select original_started_at from public.correction_requests where id = pg_temp.fixture_id(117,1)), '2010-01-01 08:00Z'::timestamptz, 'immutable original snapshot retained');
reset role;
select is((select original_time_entry_version from public.correction_requests where id = pg_temp.fixture_id(117,1)), 1, 'immutable factual version snapshot retained');
set local role authenticated;
select pg_temp.login(2);
select is((select manager_note from public.correction_requests where id = pg_temp.fixture_id(117,1)), 'synthetic manager note', 'manager note trimmed');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,1), pg_temp.fixture_id(117,1), 'approve', '  synthetic manager note  ')), 'approved', 'same UUID and exact payload replay original result');
select throws_ok($$select * from public.decide_correction_request(pg_temp.fixture_id(118,1), pg_temp.fixture_id(117,1), 'approve', 'synthetic manager note')$$, '22023', 'decision_request_id_reused', 'changed raw note fails even if normalization matches');
select throws_ok($$select * from public.decide_correction_request(pg_temp.fixture_id(118,1), pg_temp.fixture_id(117,2), 'approve', '  synthetic manager note  ')$$, '22023', 'decision_request_id_reused', 'UUID cannot bind another correction');
select throws_ok($$select * from public.decide_correction_request(pg_temp.fixture_id(118,1), pg_temp.fixture_id(117,1), 'reject', '  synthetic manager note  ')$$, '22023', 'decision_request_id_reused', 'UUID cannot change decision');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,21), pg_temp.fixture_id(117,1), 'approve', '')), 'already_decided', 'new UUID against terminal request safe');

select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,2), pg_temp.fixture_id(117,2), 'approve', '')), 'approved', 'missed entry approved');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,2), pg_temp.fixture_id(117,2), 'approve', '')), 'approved', 'missed approval retry replays');
select is((select count(*) from public.time_entries where last_correction_request_id = pg_temp.fixture_id(117,2)), 1::bigint, 'missed approval creates exactly one factual entry');
select ok((select origin = 'approved_missed_entry' and version = 1 and ended_at is not null
  and started_at = '2010-01-02 08:15:00.123456Z'::timestamptz and ended_at = '2010-01-02 10:00:00.654321Z'::timestamptz
  from public.time_entries where last_correction_request_id = pg_temp.fixture_id(117,2)), 'missed entry has exact interval, closed state, distinct origin');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,3), pg_temp.fixture_id(117,3), 'reject', 'synthetic rejection <script>text</script>')), 'rejected', 'manager rejects with explanation');
select ok((select started_at = '2010-01-03 08:00Z'::timestamptz and ended_at = '2010-01-03 10:00Z'::timestamptz and version = 1
  from public.time_entries where id = pg_temp.fixture_id(116,3)), 'rejection changes no factual values/version');

-- ABA timestamp restoration cannot make an old adjustment snapshot current again.
reset role;
update public.time_entries set started_at = started_at + interval '1 minute'
  where id = pg_temp.fixture_id(116,10);
update public.time_entries set started_at = '2010-01-10 08:00Z', ended_at = '2010-01-10 10:00Z'
  where id = pg_temp.fixture_id(116,10);
select ok((select entry.started_at = request.original_started_at
    and entry.ended_at = request.original_ended_at
    and entry.version = 3 and request.original_time_entry_version = 1
  from public.time_entries as entry
  join public.correction_requests as request on request.target_time_entry_id = entry.id
  where request.id = pg_temp.fixture_id(117,10)),
  'ABA restores timestamps while factual version records both changes');
set local role authenticated;
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(
  pg_temp.fixture_id(118,40), pg_temp.fixture_id(117,10), 'approve', '')),
  'stale_request', 'ABA version mismatch returns stale request');
select is((select status from public.correction_requests where id = pg_temp.fixture_id(117,10)),
  'pending', 'ABA stale request remains pending');
select ok((select started_at = '2010-01-10 08:00Z'::timestamptz
    and ended_at = '2010-01-10 10:00Z'::timestamptz and version = 3
  from public.time_entries where id = pg_temp.fixture_id(116,10)),
  'ABA stale approval applies no proposed timestamp');
select is((select count(*) from public.audit_events
  where (entity_id = pg_temp.fixture_id(117,10) and action = 'correction_request.approved')
    or (entity_id = pg_temp.fixture_id(116,10)
      and action in ('time_entry.adjusted','time_entry.missed_entry_added'))),
  0::bigint, 'ABA stale approval appends no decision or factual audit');
select is((select result_code from public.decide_correction_request(
  pg_temp.fixture_id(118,40), pg_temp.fixture_id(117,10), 'approve', '')),
  'stale_request', 'ABA stale retry replays durable safe result');
reset role;
select is((select count(*) from private.manager_decision_operations
  where request_id = pg_temp.fixture_id(118,40)), 1::bigint,
  'ABA stale retry keeps one immutable operation outcome');

reset role;
update public.time_entries set ended_at = ended_at + interval '1 minute' where id = pg_temp.fixture_id(116,4);
update public.time_entries set ended_at = null where id = pg_temp.fixture_id(116,6);
set local role authenticated;
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,4), pg_temp.fixture_id(117,4), 'approve', '')), 'stale_request', 'changed factual snapshot fails stale');
select is((select status from public.correction_requests where id = pg_temp.fixture_id(117,4)), 'pending', 'stale request remains pending');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,5), pg_temp.fixture_id(117,5), 'approve', '')), 'overlap', 'current factual overlap revalidated');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,6), pg_temp.fixture_id(117,6), 'approve', '')), 'stale_request', 'open target fails stale');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,14), pg_temp.fixture_id(117,14), 'approve', '')), 'invalid_interval', 'future proposal cannot apply');
select pg_temp.login(1);
select is((select result_code from public.withdraw_employee_correction_request(gen_random_uuid(), pg_temp.fixture_id(117,8))), 'withdrawn', 'employee withdrawal remains supported');
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,8), pg_temp.fixture_id(117,8), 'approve', '')), 'already_decided', 'withdrawn request terminal');
reset role;
update public.time_entries set ended_at = '2010-01-06 10:00Z' where id = pg_temp.fixture_id(116,6);

-- Audit payloads are whitelists. Exactly one event per real transition, no notes.
select is((select count(*) from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and action in ('correction_request.approved','correction_request.rejected')), 3::bigint, 'exactly three real decisions, no replay/no-op audits');
select is((select count(*) from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and action in ('time_entry.adjusted','time_entry.missed_entry_added')), 2::bigint, 'exactly two factual audits, none for rejection');
select ok(not exists(select 1 from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and action in ('correction_request.approved','correction_request.rejected','time_entry.adjusted','time_entry.missed_entry_added')
  and actor_user_id <> pg_temp.fixture_id(111,2)), 'authenticated manager owns every decision/application audit');
select ok(not exists(select 1 from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and action in ('correction_request.approved','correction_request.rejected')
  and (before_data <> '{"status":"pending"}'::jsonb or after_data not in ('{"status":"approved"}'::jsonb, '{"status":"rejected"}'::jsonb))), 'decision audits exactly status-focused');
select is((select before_data from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and action = 'time_entry.adjusted'),
  jsonb_build_object('started_at','2010-01-01 08:00Z'::timestamptz,'ended_at','2010-01-01 10:00Z'::timestamptz,'version',1,'origin','clock','correction_request_id',null), 'factual audit exact old timestamps/version/origin');
select is((select after_data from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and action = 'time_entry.adjusted'),
  jsonb_build_object('started_at','2010-01-01 08:15:00.123456Z'::timestamptz,'ended_at','2010-01-01 10:00:00.654321Z'::timestamptz,'version',2,'origin','clock','correction_request_id',pg_temp.fixture_id(117,1)), 'factual audit exact new timestamps/version/request');
select ok(not exists(select 1 from public.audit_events where organization_id = pg_temp.fixture_id(113,1) and (coalesce(before_data,'{}') || coalesce(after_data,'{}'))::text ~ 'synthetic|employee_reason|manager_note|email|token|password'), 'reasons notes and credentials absent from every audit');
select ok((select entry.created_at = request.resolved_at and entry.created_at = operation.processed_at
  from public.time_entries entry join public.correction_requests request on request.applied_time_entry_id = entry.id
  join private.manager_decision_operations operation on operation.request_id = request.resolution_request_id
  where request.id = pg_temp.fixture_id(117,2)), 'database time controls missed-entry creation and decision ledger');
select throws_ok($$update public.correction_requests set manager_note = 'changed' where id = pg_temp.fixture_id(117,3)$$, '55000', 'correction_request_immutable', 'terminal note immutable');
select throws_ok($$update public.correction_requests set employee_reason = 'changed' where id = pg_temp.fixture_id(117,4)$$, '55000', 'correction_request_immutable', 'pending claim immutable');
select throws_ok($$update private.manager_decision_operations set result_code = 'rejected'$$, '55000', 'correction_operation_immutable', 'decision ledger updates blocked');
select throws_ok($$delete from private.manager_decision_operations$$, '55000', 'correction_operation_immutable', 'decision ledger delete blocked');
select throws_ok($$truncate private.manager_decision_operations$$, '55000', 'correction_operation_immutable', 'decision ledger truncate blocked');
select throws_ok($$delete from public.time_entries$$, '55000', 'time_entry_history_required', 'factual entries never deleted');
select throws_ok($$truncate public.time_entries cascade$$, '55000', null, 'factual entries never truncated');

set local role authenticated;
select pg_temp.login(1);
select ok(public.get_employee_correction_requests()->'requests' @> jsonb_build_array(jsonb_build_object('id',pg_temp.fixture_id(117,3),'status','rejected','manager_note','synthetic rejection <script>text</script>')), 'employee sees rejection and explanation');
select ok(public.get_employee_correction_requests()->'entries' @> jsonb_build_array(jsonb_build_object('id',pg_temp.fixture_id(116,1),'started_at','2010-01-01 08:15:00.123456Z'::timestamptz)), 'employee factual history sees approved adjustment');
select ok(not exists(select 1 from jsonb_array_elements(public.get_employee_correction_requests()->'requests') as item
  where item ?| array['resolved_by_membership_id','resolution_request_id','actor_user_id']), 'employee reader omits manager internal identifiers');
select throws_ok($$select resolved_by_membership_id from public.correction_requests$$, '42501', null, 'employee cannot select manager identity directly');
select pg_temp.login(3);
select is((select count(*) from public.time_entries), 0::bigint, 'other tenant employee never sees approved facts');
select is((select count(*) from public.correction_requests), 1::bigint, 'other tenant employee reads own claim only');
reset role;
-- Exact new constraints, column privileges, references and payload shape.
select is(array(select conname::text from pg_constraint where conrelid = 'private.manager_decision_operations'::regclass order by conname),
  array['manager_decision_operations_decision_check','manager_decision_operations_entry_fkey',
    'manager_decision_operations_hash_check','manager_decision_operations_manager_fkey',
    'manager_decision_operations_pkey','manager_decision_operations_request_fkey','manager_decision_operations_result_check'],
  'decision ledger has exact constraint inventory');
select ok((select contype = 'f' and confdeltype = 'r' and cardinality(conkey) = expected.columns
  from pg_constraint where conrelid = expected.relation::regclass and conname = expected.name), expected.name || ' tenant-consistent restrictive foreign key')
from (values ('public.time_entries','time_entries_correction_request_fkey',4),
  ('public.correction_requests','correction_requests_applied_entry_fkey',4),
  ('private.manager_decision_operations','manager_decision_operations_manager_fkey',2),
  ('private.manager_decision_operations','manager_decision_operations_request_fkey',3),
  ('private.manager_decision_operations','manager_decision_operations_entry_fkey',3)) expected(relation,name,columns);
select is(array(select attname::text from pg_attribute where attrelid = 'public.correction_requests'::regclass and attnum > 0 and not attisdropped
  and has_column_privilege('authenticated','public.correction_requests',attname,'SELECT') order by attname),
  array['applied_time_entry_id','created_at','employee_membership_id','employee_reason','id','manager_note',
    'organization_id','original_ended_at','original_started_at','proposed_ended_at','proposed_started_at','request_kind',
    'resolved_at','status','submission_request_id','target_time_entry_id','withdrawal_request_id','withdrawn_at','worksite_id'],
  'browser correction reads use exact safe column whitelist');
select ok(exists(select 1 from pg_indexes where schemaname = 'public' and indexname = expected.name), expected.name || ' exists')
from unnest(array['correction_requests_review_queue_idx','correction_requests_applied_entry_idx','time_entries_last_correction_request_idx']) expected(name);
select ok(p.proowner = 'postgres'::regrole and not p.prosecdef and p.proconfig = array['search_path=""']
  and not has_function_privilege('authenticated',p.oid,'EXECUTE') and not has_function_privilege('anon',p.oid,'EXECUTE')
  and not has_function_privilege('service_role',p.oid,'EXECUTE'), 'factual guard exact ownership, path, invoker and no app execution')
from pg_proc p where p.oid = 'private.guard_time_entry_history()'::regprocedure;
select throws_ok($$update public.time_entries set last_correction_request_id = pg_temp.fixture_id(117,13) where id = pg_temp.fixture_id(116,3)$$,
  '23503', null, 'factual entry cannot link another tenant correction');
select throws_ok($$insert into public.time_entries (organization_id,membership_id,worksite_id,started_at,version)
  values(pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),pg_temp.fixture_id(114,1),'2010-01-01 08:00Z',0)$$,
  '23514', null, 'factual version must be positive');
select throws_ok($$insert into public.time_entries (organization_id,membership_id,worksite_id,started_at,origin)
  values(pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),pg_temp.fixture_id(114,1),'2010-01-01 08:00Z','manual')$$,
  '23514', null, 'unknown factual origin rejected');
select throws_ok($$insert into public.time_entries (organization_id,membership_id,worksite_id,started_at,origin)
  values(pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),pg_temp.fixture_id(114,1),'2010-01-01 08:00Z','approved_missed_entry')$$,
  '23514', null, 'missed entry requires closed correction association');
select throws_ok($$insert into public.correction_requests (organization_id,employee_membership_id,worksite_id,
  request_kind,proposed_started_at,proposed_ended_at,employee_reason,submission_request_id,status,resolved_at,resolved_by_membership_id,resolution_request_id,manager_note)
  values(pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),pg_temp.fixture_id(114,1),'missed_entry',
    '2010-03-01 08:00Z','2010-03-01 10:00Z','fixture',gen_random_uuid(),'rejected',clock_timestamp(),pg_temp.fixture_id(115,4),gen_random_uuid(),'fixture')$$,
  '23503', null, 'resolver must belong to request tenant');

-- Adjustment version snapshots are positive and required; missed claims have none.
insert into public.time_entries (id,organization_id,membership_id,worksite_id,started_at,ended_at)
values(pg_temp.fixture_id(116,20),pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),
  pg_temp.fixture_id(114,1),'2010-04-01 08:00Z','2010-04-01 10:00Z');
select throws_ok(format($sql$insert into public.correction_requests (
  id,organization_id,employee_membership_id,worksite_id,target_time_entry_id,request_kind,
  proposed_started_at,proposed_ended_at,original_started_at,original_ended_at,
  original_time_entry_version,employee_reason,submission_request_id)
values(%L,%L,%L,%L,%L,'adjustment','2010-04-01 08:15Z','2010-04-01 10:00Z',
  '2010-04-01 08:00Z','2010-04-01 10:00Z',%s,'invalid version fixture',gen_random_uuid())$sql$,
  pg_temp.fixture_id(117,40 + ordinal),pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),
  pg_temp.fixture_id(114,1),pg_temp.fixture_id(116,20),snapshot),
  '23514', null, description)
from (values (1,'null','adjustment version snapshot cannot be null'),
  (2,'0','adjustment version snapshot cannot be zero'),
  (3,'-1','adjustment version snapshot cannot be negative')) as cases(ordinal,snapshot,description);
select throws_ok($$insert into public.correction_requests (
  id,organization_id,employee_membership_id,worksite_id,request_kind,proposed_started_at,
  proposed_ended_at,original_time_entry_version,employee_reason,submission_request_id)
values(pg_temp.fixture_id(117,44),pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),
  pg_temp.fixture_id(114,1),'missed_entry','2010-04-02 08:00Z','2010-04-02 10:00Z',
  1,'invalid missed version fixture',gen_random_uuid())$$,
  '23514', null, 'missed entry cannot carry factual version snapshot');
select throws_ok($$update public.correction_requests
  set original_time_entry_version = original_time_entry_version + 1
  where id = pg_temp.fixture_id(117,10)$$,
  '55000','correction_request_immutable','submitted factual version snapshot is immutable');

-- Safe no-op results are durable too, even when surrounding facts later change.
set local role authenticated;
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,4), pg_temp.fixture_id(117,4), 'approve', '')),
  'stale_request', 'stale same-ID replay preserves original safe outcome');
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,31), pg_temp.fixture_id(117,3), 'approve', '')),
  'already_decided', 'rejected request cannot be approved');
reset role;
insert into public.memberships (id,organization_id,user_id,role,status)
values(pg_temp.fixture_id(115,13),pg_temp.fixture_id(113,1),pg_temp.fixture_id(111,13),'manager','active');
insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at)
values(pg_temp.fixture_id(119,13),pg_temp.fixture_id(111,13),'Synthetic manager TOTP','totp','verified',now(),now());
update auth.sessions set factor_id=pg_temp.fixture_id(119,13),aal='aal2'
where id=pg_temp.fixture_id(112,13);
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values(pg_temp.fixture_id(120,13),pg_temp.fixture_id(112,13),now(),now(),'totp');
insert into private.manager_mfa_registrations(auth_user_id,provider_factor_id)
values(pg_temp.fixture_id(111,13),pg_temp.fixture_id(119,13));
set local role authenticated;
select pg_temp.login(13);
select throws_ok($$select * from public.decide_correction_request(pg_temp.fixture_id(118,1),pg_temp.fixture_id(117,1),'approve','  synthetic manager note  ')$$,
  '22023','decision_request_id_reused','decision UUID cannot be replayed by a different manager');
reset role;
update public.memberships set status = 'inactive' where id = pg_temp.fixture_id(115,1);
set local role authenticated;
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,32),pg_temp.fixture_id(117,9),'approve','')),
  'unavailable','approval revalidates active employee membership');
reset role;
update public.memberships set status = 'active' where id = pg_temp.fixture_id(115,1);
insert into public.worksites (id,organization_id,name) values(pg_temp.fixture_id(114,4),pg_temp.fixture_id(113,1),'Synthetic second worksite');
set local role authenticated;
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,33),pg_temp.fixture_id(117,9),'approve','')),
  'unavailable','approval revalidates sole worksite');
reset role;
delete from public.worksites where id = pg_temp.fixture_id(114,4);

insert into public.memberships (id,organization_id,user_id,role,status)
values(pg_temp.fixture_id(115,21),pg_temp.fixture_id(113,3),pg_temp.fixture_id(111,1),'employee','active');
set local role authenticated;
select pg_temp.login(1);
select is((select count(*) from public.time_entries),0::bigint,'ambiguous employee cannot read corrected factual rows');
select is((select count(*) from public.correction_requests),0::bigint,'ambiguous employee cannot read correction decisions');
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,36),pg_temp.fixture_id(117,9),'approve','')),
  'unavailable','approval rejects ambiguous employee membership');
reset role;
update public.memberships set status='inactive' where id=pg_temp.fixture_id(115,21);
set local role authenticated;
select pg_temp.login(2);
reset role;

-- A failed audit must roll back both request resolution and factual application.
create function pg_temp.reject_test_audit() returns trigger language plpgsql as $$
begin raise exception using errcode='P0001', message='synthetic_audit_failure'; end; $$;
create trigger synthetic_audit_failure before insert on public.audit_events for each row execute function pg_temp.reject_test_audit();
set local role authenticated;
select is((select status from public.correction_requests where id=pg_temp.fixture_id(117,9)),'pending','rollback fixture begins pending');
select throws_ok($$select * from public.decide_correction_request(pg_temp.fixture_id(118,34),pg_temp.fixture_id(117,9),'approve','')$$,
  'P0001','synthetic_audit_failure','audit failure aborts approval transaction');
select is((select status from public.correction_requests where id=pg_temp.fixture_id(117,9)),'pending','failed audit rolls back request resolution');
select is((select count(*) from public.time_entries where last_correction_request_id=pg_temp.fixture_id(117,9)),0::bigint,'failed audit rolls back inserted fact');
reset role;
select is((select count(*) from private.manager_decision_operations where request_id=pg_temp.fixture_id(118,34)),0::bigint,'failed approval stores no success ledger');
drop trigger synthetic_audit_failure on public.audit_events;

-- Defensive application checks remain effective even against invalid owner fixtures.
alter table public.correction_requests drop constraint correction_requests_proposal_chronology_check;
insert into public.correction_requests (id,organization_id,employee_membership_id,worksite_id,request_kind,
  proposed_started_at,proposed_ended_at,employee_reason,submission_request_id)
values(pg_temp.fixture_id(117,15),pg_temp.fixture_id(113,1),pg_temp.fixture_id(115,1),pg_temp.fixture_id(114,1),
  'missed_entry','2010-03-01 10:00Z','2010-03-01 09:00Z','invalid owner fixture',gen_random_uuid());
set local role authenticated;
select is((select result_code from public.decide_correction_request(pg_temp.fixture_id(118,35),pg_temp.fixture_id(117,15),'approve','')),
  'invalid_interval','application rejects invalid chronology independently of constraint');
reset role;
select * from finish();
rollback;
