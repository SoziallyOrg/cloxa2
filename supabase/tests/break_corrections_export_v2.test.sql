begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

create function pg_temp.bid(p integer, n integer) returns uuid language sql immutable as $$
  select (p::text || '00000-0000-4000-9000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.login(n integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.bid(901,n),
    'session_id',pg_temp.bid(902,n),'role','authenticated')::text,true);
$$;
insert into auth.users(id,email,email_confirmed_at,encrypted_password,banned_until,deleted_at)
select pg_temp.bid(901,n),'break.'||n||'@example.test',case when n<>7 then now() end,
  'synthetic-not-a-password',case when n=8 then now()+interval '1 day' end,
  case when n=9 then now() end from generate_series(1,12) n;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select pg_temp.bid(902,n),pg_temp.bid(901,n),now(),now(),case when n=6 then now()-interval '1 second' end
  from generate_series(1,12) n;
insert into public.organizations(id,name,lifecycle_status) values
  (pg_temp.bid(903,1),'Fictieve pauzes','research_pilot'),
  (pg_temp.bid(903,2),'Andere fictieve pauzes','paid_beta'),
  (pg_temp.bid(903,3),'Geschorste fictieve pauzes','suspended');
insert into public.worksites(id,organization_id,name)
select pg_temp.bid(904,n),pg_temp.bid(903,n),'Fictieve werkplek' from generate_series(1,3) n;
insert into public.memberships(id,organization_id,user_id,role,status)
select pg_temp.bid(905,n),pg_temp.bid(903,case when n=3 then 2 when n=5 then 3 else 1 end),
  pg_temp.bid(901,n),case when n=2 then 'manager' else 'employee' end,
  case when n=4 then 'inactive' else 'active' end from generate_series(1,12) n;
insert into public.memberships(id,organization_id,user_id,role,status)
values(pg_temp.bid(905,20),pg_temp.bid(903,2),pg_temp.bid(901,10),'employee','active');

insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at,created_at)
values(pg_temp.bid(906,1),pg_temp.bid(903,1),pg_temp.bid(905,1),pg_temp.bid(904,1),'2010-01-01 08:00Z','2010-01-01 08:00Z');
insert into public.time_breaks(id,organization_id,employee_membership_id,worksite_id,time_entry_id,started_at,created_at)
values(pg_temp.bid(908,1),pg_temp.bid(903,1),pg_temp.bid(905,1),pg_temp.bid(904,1),pg_temp.bid(906,1),'2010-01-01 10:00Z','2010-01-01 10:00Z');
update public.time_breaks set ended_at='2010-01-01 10:15Z' where id=pg_temp.bid(908,1);
update public.time_entries set ended_at='2010-01-01 16:00:00.000001Z' where id=pg_temp.bid(906,1);
create function pg_temp.submit(n integer,k text default 'missed_break',target uuid default null,bv integer default null,pv integer default 2,
  start_local text default '2010-01-01T13:00:00.000001',end_local text default '2010-01-01T13:30:00.000002') returns jsonb language sql as $$
  select public.change_break_correction(pg_temp.bid(907,n),k,pg_temp.bid(906,1),target,pv,bv,
    case when k='removal' then null else start_local end,case when k='removal' then null else '' end,
    case when k='removal' then null else end_local end,case when k='removal' then null else '' end,'Fictieve reden');
$$;
create function pg_temp.claim(n integer) returns uuid language sql as $$ select id from public.break_correction_requests where submission_request_id=pg_temp.bid(907,n); $$;
create function pg_temp.decide(n integer,c integer,d text default 'approve') returns jsonb language sql as $$
 select public.decide_break_correction(pg_temp.bid(909,n),pg_temp.claim(c),d,'Fictieve toelichting',true);
$$;
create function pg_temp.withdraw(n integer,c integer) returns jsonb language sql as $$
 select public.change_break_correction(pg_temp.bid(907,n),'withdraw',null,pg_temp.claim(c),null,null,null,null,null,null,null);
$$;

select ok((select relrowsecurity from pg_class where oid=t::regclass),t||' RLS')
from unnest(array['public.break_correction_requests','public.time_break_revisions','private.break_correction_request_operations','private.break_correction_decision_operations','public.time_exports_v2','private.time_export_v2_snapshots','private.time_export_v2_operations']) t;
select ok(not has_table_privilege(r,t,p),r||' denied '||t||' '||p)
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['public.break_correction_requests','public.time_break_revisions','public.time_exports_v2','private.break_correction_request_operations','private.break_correction_decision_operations','private.time_export_v2_snapshots','private.time_export_v2_operations']) t
cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(not has_table_privilege(r,t,'SELECT'),r||' cannot read ledger/snapshot')
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private.break_correction_request_operations','private.break_correction_decision_operations','private.time_export_v2_snapshots','private.time_export_v2_operations']) t;
set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.submit(1)->>'result_code','submitted','missed request');
select is(pg_temp.submit(1),pg_temp.submit(1),'exact submission replay');
select is(public.get_break_corrections(pg_temp.bid(907,999))->>'request_id',pg_temp.bid(907,999)::text,'read UUID');
select is(pg_temp.submit(2)->>'result_code','pending_break_correction','pending break blocks next claim');
select throws_ok($$select public.submit_employee_correction_request(pg_temp.bid(907,3),'adjustment',pg_temp.bid(906,1)::text,'2010-01-01T09:01','','2010-01-01T17:00','','Fictief')$$,'22023','correction_pending_conflict','shift submission blocks pending break');
select throws_ok($$select pg_temp.submit(1,'removal',pg_temp.bid(908,1),2)$$,'22023','break_request_id_reused','changed kind rejected');
select pg_temp.login(2);
select is(public.create_time_export_v2(pg_temp.bid(907,4),'2010-01-01','2010-01-01',true)->>'result_code','pending_break_correction','pending claim blocks v2');
select is(pg_temp.decide(1,1)->>'result_code','approved','missed approved');
select is(pg_temp.decide(1,1),pg_temp.decide(1,1),'exact decision replay');
select is(pg_temp.decide(2,1,'reject')->>'result_code','already_terminal','second decision cannot branch');
select throws_ok($$select pg_temp.decide(1,1,'reject')$$,'22023','break_request_id_reused','changed decision denied');
select is(public.create_time_export_v2(pg_temp.bid(907,4),'2010-01-01','2010-01-01',true)->>'result_code','pending_break_correction','blocked export remains durable');
select is(public.create_time_export_v2(pg_temp.bid(907,5),'2010-01-01','2010-01-01',true)->>'result_code','created','v2 created');
select is(public.create_time_export_v2(pg_temp.bid(907,5),'2010-01-01','2010-01-01',true),public.create_time_export_v2(pg_temp.bid(907,5),'2010-01-01','2010-01-01',true),'exact export replay');
select is((select manifest->>'total_gross_duration_microseconds' from public.time_exports_v2),'28800000001','exact gross');
select is((select manifest->>'total_unpaid_break_duration_microseconds' from public.time_exports_v2),'2700000001','exact unpaid');
select is((select manifest->>'total_net_worked_duration_microseconds' from public.time_exports_v2),'26100000000','exact net');
select is((select count(*)::int from public.time_break_revisions),1,'one revision');
reset role;
create temp table saved_snapshot as select * from private.time_export_v2_snapshots;
select ok(not (select records->0 ? 'duration_microseconds' from saved_snapshot),'v2 removes ambiguous v1 duration key');
select is((select version from private.effective_time_breaks(pg_temp.bid(906,1)) where logical_break_id=pg_temp.bid(908,1)),2,'original live initial version');
select is((select count(*)::int from private.effective_time_breaks(pg_temp.bid(906,1)) where not removed),2,'resolver combines original and missed');
select is((select count(*)::int from public.time_exports_v2),1,'blocked creation no metadata');
select is((select count(*)::int from public.audit_events where action='time_export.created' and organization_id=pg_temp.bid(903,1)),1,'blocked creation no audit');
select ok(not exists(select 1 from public.audit_events where action like 'break_correction_request.%' and after_data - 'status' <> '{}'::jsonb),'request audits minimal');
select ok(not exists(select 1 from public.audit_events where action like 'time_break_revision.%' and (after_data::text like '%Fictieve%' or before_data::text like '%Fictieve%')),'revision audits omit reason/note');
set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.submit(10,'adjustment',pg_temp.bid(908,1),2,2,'2010-01-01T11:00','2010-01-01T11:20')->>'result_code','submitted','adjustment targets effective version');
select pg_temp.login(2);
select is(pg_temp.decide(10,10)->>'result_code','approved','adjustment approval');
select pg_temp.login(1);
select is(pg_temp.submit(11,'removal',pg_temp.bid(908,1),2)->>'result_code','stale_request','old visible version rejected');
select is(pg_temp.submit(12,'removal',pg_temp.bid(908,1),3)->>'result_code','submitted','removal targets latest');
select is(pg_temp.withdraw(13,12)->>'result_code','withdrawn','employee withdraws own pending');
select is(pg_temp.withdraw(13,12),pg_temp.withdraw(13,12),'withdrawal replay');
select is(pg_temp.withdraw(14,12)->>'result_code','already_terminal','withdrawn terminal');
select is(pg_temp.submit(15,'removal',pg_temp.bid(908,1),3)->>'result_code','submitted','removal resubmission');
select pg_temp.login(2);
select is(pg_temp.decide(15,15)->>'result_code','approved','removal appends tombstone');
reset role;
select is((select version from private.effective_time_breaks(pg_temp.bid(906,1)) where logical_break_id=pg_temp.bid(908,1)),4,'linear versions');
select ok((select removed from private.effective_time_breaks(pg_temp.bid(906,1)) where logical_break_id=pg_temp.bid(908,1)),'effective tombstone');
select is((select ended_at from public.time_breaks where id=pg_temp.bid(908,1)),'2010-01-01 10:15Z'::timestamptz,'original unchanged');
select is((select records from private.time_export_v2_snapshots),(select records from saved_snapshot),'snapshot unchanged after adjustment/removal');
select is((select manifest->>'dataset_sha256' from public.time_exports_v2),
  (select encode(sha256(convert_to(jsonb_build_object('manifest',e.manifest-'dataset_sha256','records',s.records)::text,'UTF8')),'hex') from public.time_exports_v2 e join private.time_export_v2_snapshots s on s.export_id=e.id),'stored canonical hash');
set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.submit(20,'adjustment',(select logical_break_id from public.break_correction_requests where id=pg_temp.claim(1)),1,2,'2010-01-01T13:00','2010-01-01T13:15')->>'result_code','submitted','missed break supports adjustment');
reset role;
update public.time_entries set started_at=started_at+interval '1 minute' where id=pg_temp.bid(906,1);
update public.time_entries set started_at=started_at-interval '1 minute' where id=pg_temp.bid(906,1);
set local role authenticated;
select pg_temp.login(2);
select is(pg_temp.decide(20,20)->>'result_code','stale_request','ABA parent drift rejected');
select is(pg_temp.decide(21,20,'reject')->>'result_code','rejected','stale rejection closes without fact');
select pg_temp.login(1);
select is(pg_temp.submit(22,'missed_break',null,null,4,'2010-01-01T13:00','2010-01-01T13:45')->>'result_code','overlap','effective overlap rejected');
select is(pg_temp.submit(23,'missed_break',null,null,4,'2010-01-01T13:30:00.000002','2010-01-01T13:45')->>'result_code','submitted','touching boundary allowed');
select is(pg_temp.withdraw(24,23)->>'result_code','withdrawn','withdraw touching request');
select is(pg_temp.submit(25,'missed_break',null,null,4,'2010-01-01T08:59','2010-01-01T09:30')->>'result_code','invalid_interval','containment required');
select is(pg_temp.submit(26,'missed_break',null,null,4,'2010-01-01T14:00','2010-01-01T14:00')->>'result_code','invalid_interval','positive required');
select throws_ok($$select pg_temp.submit(27,'missed_break',null,null,4,'2010-03-28T02:30','2010-03-28T04:00')$$,'22008','correction_nonexistent_local_time','DST gap');
select throws_ok($$select pg_temp.submit(28,'missed_break',null,null,4,'2010-10-31T02:30','2010-10-31T04:00')$$,'22023','correction_ambiguous_local_time','DST ambiguous');
reset role;
select is(private.resolve_brussels_local('2010-10-31T02:30:00.000001','later')-private.resolve_brussels_local('2010-10-31T02:30:00.000001','earlier'),interval '1 hour','DST explicit occurrences');
select throws_ok($$update public.time_break_revisions set version=version$$,'55000','break_revision_history_required','revision update guard');
select throws_ok($$delete from public.time_break_revisions$$,'55000','break_revision_history_required','revision delete guard');
select throws_ok($$truncate public.time_break_revisions cascade$$,'55000',null,'revision truncate guard');
select throws_ok($$update public.break_correction_requests set employee_reason='changed'$$,'55000','break_request_history_required','request immutable claim');
select throws_ok($$delete from public.break_correction_requests$$,'55000','break_request_history_required','request delete guard');
select throws_ok($$truncate public.break_correction_requests cascade$$,'55000',null,'request truncate guard');
select throws_ok(format('update private.%I set result=result',t),'55000','correction_operation_immutable','ledger update guarded') from unnest(array['break_correction_request_operations','break_correction_decision_operations','time_export_v2_operations']) t;
select throws_ok(format('truncate private.%I',t),'55000','correction_operation_immutable','ledger truncate guarded') from unnest(array['break_correction_request_operations','break_correction_decision_operations','time_export_v2_operations']) t;
select throws_ok($$update private.time_export_v2_snapshots set records=records$$,'55000','correction_operation_immutable','snapshot update guard');
select throws_ok($$truncate private.time_export_v2_snapshots$$,'55000','correction_operation_immutable','snapshot truncate guard');
set local role authenticated;
select pg_temp.login(3);
select is((select count(*)::int from public.break_correction_requests),0,'cross tenant request RLS');
select is((select count(*)::int from public.time_break_revisions),0,'cross tenant revision RLS');
select throws_ok($$select pg_temp.submit(1)$$,'22023','break_request_id_reused','UUID actor binding');
select throws_ok($$select pg_temp.submit(500)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','target tenant hidden');
reset role;

-- Fault injection at both approval audit and export snapshot rolls all writes back.
create function pg_temp.fail_phase8() returns trigger language plpgsql as $$ begin raise exception 'injected_phase8_failure'; end $$;
set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.submit(30,'missed_break',null,null,4,'2010-01-01T14:00','2010-01-01T14:15')->>'result_code','submitted','fault test claim');
reset role;
create trigger fault_approval before insert on public.audit_events for each row when(new.action='break_correction_request.approved') execute function pg_temp.fail_phase8();
set local role authenticated;
select pg_temp.login(2);
select throws_ok($$select pg_temp.decide(30,30)$$,'P0001','injected_phase8_failure','approval audit rollback');
reset role;
select is((select status from public.break_correction_requests where id=pg_temp.claim(30)),'pending','failed approval status rollback');
select is((select count(*)::int from public.time_break_revisions where correction_request_id=pg_temp.claim(30)),0,'failed approval no revision');
select is((select count(*)::int from private.break_correction_decision_operations where request_id=pg_temp.bid(909,30)),0,'failed approval no result');
drop trigger fault_approval on public.audit_events;
set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.withdraw(31,30)->>'result_code','withdrawn','fixture claim withdrawn');
reset role;
create trigger fault_export before insert on private.time_export_v2_snapshots for each row execute function pg_temp.fail_phase8();
set local role authenticated;
select pg_temp.login(2);
select throws_ok($$select public.create_time_export_v2(pg_temp.bid(907,32),'2010-01-01','2010-01-01',true)$$,'P0001','injected_phase8_failure','export snapshot rollback');
reset role;
select is((select count(*)::int from public.time_exports_v2),1,'failed export no metadata');
select is((select count(*)::int from private.time_export_v2_operations where request_id=pg_temp.bid(907,32)),0,'failed export no result');
drop trigger fault_export on private.time_export_v2_snapshots;

set local role authenticated;
select pg_temp.login(1);
select is(pg_temp.submit(40,'removal',(select logical_break_id from public.break_correction_requests where id=pg_temp.claim(1)),1,4)->>'result_code','submitted','remove last missed break');
select pg_temp.login(2);
select is(pg_temp.decide(40,40)->>'result_code','approved','last break removed');
select is((select result_code from public.create_time_export(pg_temp.bid(907,41),'2010-01-01','2010-01-01',true)),'break_data_requires_v2','v1 remains closed after all removals');
select is(public.preview_time_export_v2(pg_temp.bid(907,42),'2010-01-01','2010-01-01')->'records'->0->>'unpaid_break_duration_microseconds','0','v2 effective removed sum zero');
reset role;

-- Unsupported authorization states, including expired/deleted/banned and multi-membership.
-- The resolver permits shift edits excluding tombstones; original live rows persist.
select lives_ok($$update public.time_entries set started_at='2010-01-01 14:00Z' where id=pg_temp.bid(906,1)$$,'shift containment uses effective breaks only');
select is((select count(*)::int from public.time_breaks where time_entry_id=pg_temp.bid(906,1)),1,'tombstone does not erase original');
insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at,ended_at,created_at)
select pg_temp.bid(910,n),pg_temp.bid(903,1),pg_temp.bid(905,1),pg_temp.bid(904,1),
 '2010-01-02 00:00Z'::timestamptz+n*interval '2 seconds','2010-01-02 00:00Z'::timestamptz+n*interval '2 seconds'+interval '1 second','2010-01-02 00:00Z'
from generate_series(1,10001) n;
set local role authenticated;
select pg_temp.login(2);
select is(public.create_time_export_v2(pg_temp.bid(907,80),'2010-01-02','2010-01-02',true)->>'result_code','row_limit','v2 row bound before materialization');
select is(jsonb_array_length(public.preview_time_export_v2(pg_temp.bid(907,81),'2010-01-02','2010-01-02')->'records'),0,'oversized preview has no records');
reset role;
insert into public.profiles(user_id,display_name) values(pg_temp.bid(901,1),repeat('x',1800000));
set local role authenticated;
select pg_temp.login(2);
select is(public.create_time_export_v2(pg_temp.bid(907,82),'2010-01-01','2010-01-01',true)->>'result_code','artifact_too_large','v2 byte bound before materialization');
select throws_ok($$select public.create_time_export_v2(pg_temp.bid(907,83),'2010-01-01','2010-01-01',false)$$,'22023','export_confirmation_required','manager confirmation required');
select throws_ok($$select public.create_time_export_v2(pg_temp.bid(907,84),'2010-01-01','2010-02-01',true)$$,'22023','export_invalid_period','period bound retained');
reset role;
update public.profiles set display_name='Fictief' where user_id=pg_temp.bid(901,1);
insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at,created_at)
values(pg_temp.bid(906,2),pg_temp.bid(903,1),pg_temp.bid(905,1),pg_temp.bid(904,1),'2010-01-03 08:00Z','2010-01-03 08:00Z');
set local role authenticated;
select pg_temp.login(2);
select is(public.create_time_export_v2(pg_temp.bid(907,85),'2010-01-03','2010-01-03',true)->>'result_code','open_entry','open shift blocks v2');
select is((select count(*)::int from public.time_exports_v2),1,'all blockers leave metadata unchanged');
reset role;

set local role authenticated;
select pg_temp.login(4);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 4');
select pg_temp.login(5);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 5');
select pg_temp.login(6);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 6');
select pg_temp.login(7);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 7');
select pg_temp.login(8);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 8');
select pg_temp.login(9);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 9');
select pg_temp.login(10);
select throws_ok($$select pg_temp.submit(700)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','unsupported employee 10');
select pg_temp.login(1);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{exp}','1')::text,true);
select throws_ok($$select pg_temp.submit(1)$$,'42501','Pauzeaanvraag kan niet worden verwerkt.','expired JWT replay denied');
reset role;
set local role service_role;
select pg_temp.login(1);
select throws_ok($$select pg_temp.submit(1)$$,'42501',null,'service impersonation denied');
reset role;
set local role anon;
select throws_ok($$select pg_temp.submit(1)$$,'42501',null,'anon denied');
reset role;
select * from finish();
rollback;
