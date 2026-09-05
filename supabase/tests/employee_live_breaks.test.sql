begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

create function pg_temp.bid(p integer, n integer) returns uuid language sql immutable as $$
  select (p::text || '00000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid;
$$;
create function pg_temp.login(n integer) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub',pg_temp.bid(801,n),
    'session_id',pg_temp.bid(802,n),'role','authenticated','aal','aal2',
    'amr',jsonb_build_array(jsonb_build_object('method','totp','timestamp',extract(epoch from now())::bigint)))::text,true);
$$;
insert into auth.users(id,email,email_confirmed_at,encrypted_password,banned_until,deleted_at)
select pg_temp.bid(801,n),'break.'||n||'@example.test',case when n<>7 then now() end,
  'synthetic-not-a-password',case when n=8 then now()+interval '1 day' end,
  case when n=9 then now() end from generate_series(1,12) n;
insert into auth.sessions(id,user_id,created_at,updated_at,not_after)
select pg_temp.bid(802,n),pg_temp.bid(801,n),now(),now(),case when n=6 then now()-interval '1 second' end
  from generate_series(1,12) n;
insert into public.organizations(id,name,lifecycle_status) values
  (pg_temp.bid(803,1),'Fictieve pauzes','research_pilot'),
  (pg_temp.bid(803,2),'Andere fictieve pauzes','paid_beta'),
  (pg_temp.bid(803,3),'Geschorste fictieve pauzes','suspended');
insert into public.worksites(id,organization_id,name)
select pg_temp.bid(804,n),pg_temp.bid(803,n),'Fictieve werkplek' from generate_series(1,3) n;
insert into public.memberships(id,organization_id,user_id,role,status)
select pg_temp.bid(805,n),pg_temp.bid(803,case when n=3 then 2 when n=5 then 3 else 1 end),
  pg_temp.bid(801,n),case when n=2 then 'manager' else 'employee' end,
  case when n=4 then 'inactive' else 'active' end from generate_series(1,12) n;
insert into public.memberships(id,organization_id,user_id,role,status)
values(pg_temp.bid(805,20),pg_temp.bid(803,2),pg_temp.bid(801,10),'employee','active');

insert into auth.mfa_factors (id,user_id,friendly_name,factor_type,status,created_at,updated_at)
select gen_random_uuid(),m.user_id,'Synthetic manager TOTP','totp','verified',now(),now()
from (select distinct user_id from public.memberships where role='manager'
  and user_id::text like '80100000-0000-4000-8000-%') m
where exists(select 1 from auth.sessions s where s.user_id=m.user_id);
update auth.sessions s set factor_id=f.id,aal='aal2' from auth.mfa_factors f
where f.user_id=s.user_id and f.factor_type='totp'
  and s.user_id::text like '80100000-0000-4000-8000-%';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
select gen_random_uuid(),s.id,now(),now(),'totp' from auth.sessions s join auth.mfa_factors f on f.id=s.factor_id
where s.user_id::text like '80100000-0000-4000-8000-%';
insert into private.manager_mfa_registrations(auth_user_id,provider_factor_id)
select user_id,id from auth.mfa_factors where factor_type='totp'
  and user_id::text like '80100000-0000-4000-8000-%';

select ok((select relrowsecurity from pg_class where oid='public.time_breaks'::regclass),'break RLS enabled');
select ok(not has_table_privilege(r,'public.time_breaks',p), r||' has no direct '||p)
from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p;
select ok(not has_table_privilege(r,'private.time_break_operations','SELECT'),r||' cannot read operation outcomes')
from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_function_privilege(r,'public.start_break(uuid)','EXECUTE'),r||' cannot start break')
from unnest(array['anon','service_role']) r;
select is((select count(*)::int from pg_constraint where conrelid='public.time_breaks'::regclass and contype='f'),3,'three tenant consistent foreign keys');

set local role authenticated;
select pg_temp.login(1);
select is(public.start_break(pg_temp.bid(807,1))->>'result_code','no_open_shift','start needs open shift');
select is((select result_code from public.clock_in(pg_temp.bid(807,2))),'started','start shift');
select is(public.start_break(pg_temp.bid(807,3))->>'result_code','started','start break');
select is(public.get_employee_time_clock()->>'status','on_break','clock reports break');
select is(public.start_break(pg_temp.bid(807,3))->>'result_code','started','identical start replays');
select is(public.start_break(pg_temp.bid(807,4))->>'result_code','already_on_break','second start cannot duplicate');
select throws_ok($$select public.end_break(pg_temp.bid(807,3))$$,'22023','break_request_id_reused','changed intent rejected');
select is((select result_code from public.clock_out(pg_temp.bid(807,5))),'open_break','clock out refuses open break');
select is(public.end_break(pg_temp.bid(807,6))->>'result_code','ended','end break');
select is(public.end_break(pg_temp.bid(807,6))->>'result_code','ended','end replay');
select is(public.start_break(pg_temp.bid(807,3)), public.start_break(pg_temp.bid(807,3)), 'complete start result replays identically');
select is(public.end_break(pg_temp.bid(807,6)), public.end_break(pg_temp.bid(807,6)), 'complete end result replays identically');
select is(public.start_break(pg_temp.bid(807,4))->>'request_id', pg_temp.bid(807,4)::text, 'blocker replay echoes submitted UUID');
select is((select result_code from public.clock_out(pg_temp.bid(807,5))),'open_break','clock blocker stays durable after break ends');
select is((select result_code from public.clock_out(pg_temp.bid(807,7))),'stopped','new clock operation stops');
select is(public.start_break(pg_temp.bid(807,8))->>'result_code','no_open_shift','cannot start after clock out');
select is((select count(*)::int from public.time_breaks),1,'employee sees one own break');
select is((select version from public.time_breaks),2,'closure increments version once');
select ok((select ended_at > started_at from public.time_breaks),'positive completed interval');
select throws_ok($$insert into public.time_breaks default values$$,'42501',null,'direct insert denied');
select throws_ok($$update public.time_breaks set ended_at=now()$$,'42501',null,'direct update denied');
select throws_ok($$delete from public.time_breaks$$,'42501',null,'direct delete denied');
select throws_ok($$truncate public.time_breaks$$,'42501',null,'direct truncate denied');
select pg_temp.login(3);
select is((select count(*)::int from public.time_breaks),0,'cross tenant read denied');
select throws_ok($$select public.start_break(pg_temp.bid(807,3))$$,'22023','break_request_id_reused','changed actor rejected');
select pg_temp.login(2);
select is((select count(*)::int from public.time_breaks),1,'authorized manager reads tenant breaks');
select throws_ok($$select public.start_break(pg_temp.bid(807,20))$$,'42501','Pauze kan niet worden verwerkt.','manager cannot use employee operation');
reset role;
select is((select count(*)::int from public.audit_events where action like 'time_break.%'),2,'exactly one start and end audit');
select is((select count(*)::int from private.time_break_operations),5,'durable success and safe blocker outcomes once');
select ok(not exists(select 1 from private.time_break_operations where result->>'request_id' is distinct from request_id::text), 'every persisted result contains matching request UUID');
select ok(not exists(select 1 from private.time_break_operations where
  (select array_agg(k order by k) from jsonb_object_keys(result) k) is distinct from
  array['break_id','did_transition','ended_at','request_id','result_code','started_at','time_entry_id','version']::text[]), 'persisted response has exact public keys');
select ok(not exists(select 1 from public.audit_events where action like 'time_break.%'
  and (after_data - array['break_id','time_entry_id','status','started_at','ended_at','version']) <> '{}'::jsonb),'audit contains only factual fields');
select throws_ok($$update public.time_breaks set started_at=started_at-interval '1 minute'$$,'55000','time_break_history_required','closed break immutable');
select throws_ok($$update public.time_breaks set ended_at=ended_at$$,'55000','time_break_history_required','closed no-op update denied');
select throws_ok($$delete from public.time_breaks$$,'55000','time_break_history_required','owner accidental delete guarded');
select throws_ok($$truncate public.time_breaks$$,'55000','time_break_history_required','owner accidental truncate guarded');
select throws_ok($$update private.time_break_operations set operation=operation$$,'55000','correction_operation_immutable','ledger immutable');
select throws_ok($$truncate private.time_break_operations$$,'55000','correction_operation_immutable','ledger truncate denied');
select throws_ok($$update public.time_entries set ended_at=started_at where membership_id=pg_temp.bid(805,1)$$,'55000','break_conflict','parent cannot exclude recorded break');

-- Every live authorization state is checked for each operation, including replays.
set local role authenticated;
select pg_temp.login(4);
select throws_ok($$select public.start_break(pg_temp.bid(807,34))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 4');
select pg_temp.login(5);
select throws_ok($$select public.start_break(pg_temp.bid(807,35))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 5');
select pg_temp.login(6);
select throws_ok($$select public.start_break(pg_temp.bid(807,36))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 6');
select pg_temp.login(7);
select throws_ok($$select public.start_break(pg_temp.bid(807,37))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 7');
select pg_temp.login(8);
select throws_ok($$select public.start_break(pg_temp.bid(807,38))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 8');
select pg_temp.login(9);
select throws_ok($$select public.start_break(pg_temp.bid(807,39))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 9');
select pg_temp.login(10);
select throws_ok($$select public.start_break(pg_temp.bid(807,40))$$,
  '42501','Pauze kan niet worden verwerkt.','start_break denies unsupported employee 10');
select pg_temp.login(4);
select throws_ok($$select public.end_break(pg_temp.bid(807,54))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 4');
select pg_temp.login(5);
select throws_ok($$select public.end_break(pg_temp.bid(807,55))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 5');
select pg_temp.login(6);
select throws_ok($$select public.end_break(pg_temp.bid(807,56))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 6');
select pg_temp.login(7);
select throws_ok($$select public.end_break(pg_temp.bid(807,57))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 7');
select pg_temp.login(8);
select throws_ok($$select public.end_break(pg_temp.bid(807,58))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 8');
select pg_temp.login(9);
select throws_ok($$select public.end_break(pg_temp.bid(807,59))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 9');
select pg_temp.login(10);
select throws_ok($$select public.end_break(pg_temp.bid(807,60))$$,
  '42501','Pauze kan niet worden verwerkt.','end_break denies unsupported employee 10');
select pg_temp.login(1);
select set_config('request.jwt.claims',jsonb_set(current_setting('request.jwt.claims')::jsonb,'{exp}','1')::text,true);
select throws_ok($$select public.start_break(pg_temp.bid(807,70))$$,'42501','Pauze kan niet worden verwerkt.','expired JWT denied');
reset role;
set local role service_role;
select pg_temp.login(1);
select throws_ok($$select public.start_break(pg_temp.bid(807,71))$$,'42501',null,'service impersonation denied');
reset role;
set local role anon;
select throws_ok($$select public.end_break(pg_temp.bid(807,72))$$,'42501',null,'anon denied');
reset role;

-- Fault injection proves fact, ledger, and audit share one transaction.
create function pg_temp.fail_break() returns trigger language plpgsql as $$
begin raise exception 'injected_break_failure'; end; $$;
create trigger injected_break_audit before insert on public.audit_events
for each row when (new.action like 'time_break.%') execute function pg_temp.fail_break();
set local role authenticated;
select pg_temp.login(11);
select lives_ok($$select public.clock_in(pg_temp.bid(807,80))$$,'another employee starts');
select throws_ok($$select public.start_break(pg_temp.bid(807,81))$$,'P0001','injected_break_failure','audit failure aborts break');
reset role;
select is((select count(*)::int from public.time_breaks where employee_membership_id=pg_temp.bid(805,11)),0,'failed audit leaves no break');
select is((select count(*)::int from private.time_break_operations where request_id=pg_temp.bid(807,81)),0,'failed audit leaves no outcome');
drop trigger injected_break_audit on public.audit_events;
create trigger injected_break_fact before insert on public.time_breaks for each row execute function pg_temp.fail_break();
set local role authenticated;
select throws_ok($$select public.start_break(pg_temp.bid(807,81))$$,'P0001','injected_break_failure','fact failure rolls back');
reset role;
select is((select count(*)::int from private.time_break_operations where request_id=pg_temp.bid(807,81)),0,'failed fact leaves no outcome');
drop trigger injected_break_fact on public.time_breaks;

-- Synthetic owner setup represents historical exact microsecond facts; app has no historical insertion path.
insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at)
values(pg_temp.bid(806,90),pg_temp.bid(803,1),pg_temp.bid(805,12),pg_temp.bid(804,1),'2010-01-01 08:00:00.123456Z');
insert into public.time_breaks(id,organization_id,employee_membership_id,worksite_id,time_entry_id,started_at,created_at)
values(pg_temp.bid(808,90),pg_temp.bid(803,1),pg_temp.bid(805,12),pg_temp.bid(804,1),pg_temp.bid(806,90),
  '2010-01-01 09:00:00.123456Z','2010-01-01 09:00:00.123456Z');
update public.time_breaks set ended_at='2010-01-01 09:15:00.123457Z' where id=pg_temp.bid(808,90);
update public.time_entries set ended_at='2010-01-01 10:00:00.123459Z' where id=pg_temp.bid(806,90);
select is((select (extract(epoch from ended_at-started_at)*1000000)::text from public.time_breaks where id=pg_temp.bid(808,90)), '900000001.000000','exact microseconds stored');
set local role authenticated;
select pg_temp.login(12);
select is((select result_code from public.submit_employee_correction_request(pg_temp.bid(807,91),'adjustment',pg_temp.bid(806,90)::text,
  '2010-01-01T10:01','','2010-01-01T11:00','','Fictief')),'break_conflict','submission cannot exclude break');
select is((select result_code from public.submit_employee_correction_request(pg_temp.bid(807,91),'adjustment',pg_temp.bid(806,90)::text,
  '2010-01-01T10:01','','2010-01-01T11:00','','Fictief')),'break_conflict','submission blocker replay');
select is((select result_code from public.submit_employee_correction_request(pg_temp.bid(807,92),'adjustment',pg_temp.bid(806,90)::text,
  '2010-01-01T09:01','','2010-01-01T11:00','','Fictief')),'submitted','proposal contains whole break');
select pg_temp.login(2);
select ok(public.preview_time_export('2010-01-01','2010-01-01')->'blockers' ? 'break_data_requires_v2','preview blocks break-bearing fact');
select is((select result_code from public.create_time_export(pg_temp.bid(807,93),'2010-01-01','2010-01-01',true)),
  'break_data_requires_v2','creation blocks break-bearing fact');
select is((select result_code from public.create_time_export(pg_temp.bid(807,93),'2010-01-01','2010-01-01',true)),
  'break_data_requires_v2','creation blocker replay');
select is((select result_code from public.decide_correction_request(pg_temp.bid(807,94),
  (select id from public.correction_requests where target_time_entry_id=pg_temp.bid(806,90)),'approve','')),'approved','contained proposal approved');
reset role;
select is((select count(*)::int from public.time_exports),0,'blocked export creates no metadata');
select is((select count(*)::int from private.time_export_rows),0,'blocked export creates no rows');
select is((select count(*)::int from public.audit_events where action='time_export.created'),0,'blocked export creates no audit');
select is((select count(*)::int from private.time_export_creation_operations),1,'one durable export blocker');
-- Simulate a pre-existing proposal predating break-aware submission validation.
insert into public.correction_requests (id,organization_id,employee_membership_id,worksite_id,
  target_time_entry_id,request_kind,proposed_started_at,proposed_ended_at,
  original_started_at,original_ended_at,original_time_entry_version,employee_reason,submission_request_id)
select pg_temp.bid(809,95),organization_id,membership_id,worksite_id,id,'adjustment',
  '2010-01-01 09:01Z','2010-01-01 10:00Z',started_at,ended_at,version,'Fictief',pg_temp.bid(807,95)
from public.time_entries where id=pg_temp.bid(806,90);
set local role authenticated;
select pg_temp.login(2);
select is((select result_code from public.decide_correction_request(pg_temp.bid(807,96),pg_temp.bid(809,95),'approve','')),
  'break_conflict','approval independently rejects break conflict');
select is((select result_code from public.decide_correction_request(pg_temp.bid(807,96),pg_temp.bid(809,95),'approve','')),
  'break_conflict','approval blocker replay');
reset role;
select is((select status from public.correction_requests where id=pg_temp.bid(809,95)),'pending','conflicting approval leaves pending');
select is((select count(*)::int from public.audit_events where entity_id=pg_temp.bid(809,95)),0,'conflicting approval has no audit');
select is((select count(*)::int from private.manager_decision_operations where request_id=pg_temp.bid(807,96)),1,'conflicting approval one durable outcome');

-- Open history cannot be rewritten; foreign-key and interval constraints survive owner mistakes.
set local role authenticated;
select pg_temp.login(11);
select lives_ok($$select public.start_break(pg_temp.bid(807,100))$$,'start after failed attempts');
reset role;
select throws_ok($$update public.time_breaks set started_at=started_at-interval '1 minute', ended_at=clock_timestamp()
  where employee_membership_id=pg_temp.bid(805,11)$$,'55000','time_break_history_required','open start immutable');
select throws_ok($$update public.time_breaks set ended_at=started_at where employee_membership_id=pg_temp.bid(805,11)$$,
  '23514',null,'zero interval rejected');
select throws_ok($$update public.time_breaks set ended_at='infinity' where employee_membership_id=pg_temp.bid(805,11)$$,
  '23514',null,'infinite interval rejected');
select throws_ok($$insert into public.time_breaks(organization_id,employee_membership_id,worksite_id,time_entry_id,started_at,created_at)
  select pg_temp.bid(803,2),employee_membership_id,worksite_id,time_entry_id,clock_timestamp(),clock_timestamp()
  from public.time_breaks where employee_membership_id=pg_temp.bid(805,11)$$,null,null,'cross-tenant break cannot be inserted');
insert into public.worksites(id,organization_id,name) values(pg_temp.bid(804,4),pg_temp.bid(803,1),'Tweede fictieve werkplek');
set local role authenticated;
select pg_temp.login(11);
select throws_ok($$select public.end_break(pg_temp.bid(807,101))$$,'42501','Pauze kan niet worden verwerkt.','multiple worksites denied');
reset role;
select * from finish();
rollback;
