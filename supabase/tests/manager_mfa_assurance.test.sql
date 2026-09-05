begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

insert into auth.users(id,email,email_confirmed_at,encrypted_password)
values
  ('66000000-0000-4000-8000-000000000001','mfa.manager@example.test',now(),'synthetic-not-a-password'),
  ('66000000-0000-4000-8000-000000000002','mfa.employee@example.test',now(),'synthetic-not-a-password');
insert into auth.sessions(id,user_id,created_at,updated_at)
values('66100000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001',now(),now());
insert into public.organizations(id,name,lifecycle_status)
values('66200000-0000-4000-8000-000000000001','Synthetic MFA organization','research_pilot');
insert into public.worksites(id,organization_id,name)
values('66300000-0000-4000-8000-000000000001','66200000-0000-4000-8000-000000000001','Synthetic MFA worksite');
insert into public.memberships(id,organization_id,user_id,role,status,employee_code)
values
  ('66400000-0000-4000-8000-000000000001','66200000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','manager','active',null),
  ('66400000-0000-4000-8000-000000000002','66200000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000002','employee','active','MFA-EMP');
insert into public.profiles(user_id,display_name)
values
  ('66000000-0000-4000-8000-000000000001','Synthetic MFA manager'),
  ('66000000-0000-4000-8000-000000000002','Synthetic MFA employee');

select columns_are('private','manager_mfa_registrations',array['auth_user_id','provider_factor_id','registered_at']);
select ok((select relrowsecurity from pg_class where oid='private.manager_mfa_registrations'::regclass),'registration table has RLS');
select ok(not has_table_privilege(role_name,'private.manager_mfa_registrations',privilege_name),
  role_name||' denied registration table '||privilege_name)
from unnest(array['anon','authenticated','service_role']) role_name
cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) privilege_name;
select ok(not exists(select 1 from information_schema.columns
  where table_schema='private' and table_name='manager_mfa_registrations'
    and column_name in ('secret','code','challenge')),'application registration stores no TOTP secret, code, or challenge');
select ok(p.proowner='postgres'::regrole and p.prosecdef=expected.definer and p.proconfig=array['search_path=""']
  and has_function_privilege('authenticated',p.oid,'EXECUTE'),expected.signature||' hardened and executable only through authenticated flow')
from (values
  ('private.manager_assurance_context()',true),
  ('private.get_manager_mfa_status()',true),
  ('private.register_manager_mfa()',true),
  ('public.get_manager_mfa_status()',false),
  ('public.register_manager_mfa()',false)
) expected(signature,definer)
join pg_proc p on p.oid=expected.signature::regprocedure;

set local role authenticated;
set local "request.jwt.claims"='{"sub":"66000000-0000-4000-8000-000000000001","session_id":"66100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","amr":[{"method":"password","timestamp":0}],"user_metadata":{"role":"manager","mfa":"verified"},"app_metadata":{"aal":"aal2"}}';
select is((select manager_mfa_state from public.get_manager_mfa_status()),'setup','never-enrolled manager enters setup');
select is((select count(*) from public.memberships),0::bigint,'AAL1 manager direct table read denied despite forged metadata');
select throws_ok($$select public.get_manager_team(gen_random_uuid())$$,'42501',null,'AAL1 manager RPC denied');
select throws_ok($$select public.get_time_export_snapshot(gen_random_uuid())$$,'42501',null,'AAL1 manager download RPC denied');
select throws_ok($$select public.create_employee_invitation('mfa-denied@example.test')$$,'42501',null,'AAL1 manager mutation denied');
reset role;
select is((select count(*) from public.invitations where normalized_email='mfa-denied@example.test'),0::bigint,'denied AAL1 mutation writes nothing');

insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values('66500000-0000-4000-8000-000000000001','66000000-0000-4000-8000-000000000001','Synthetic manager TOTP','totp','verified',now(),now(),'test-only-secret-never-copied');
update auth.sessions set factor_id='66500000-0000-4000-8000-000000000001',aal='aal2'
where id='66100000-0000-4000-8000-000000000001';
insert into auth.mfa_amr_claims(id,session_id,created_at,updated_at,authentication_method)
values('66600000-0000-4000-8000-000000000001','66100000-0000-4000-8000-000000000001',now(),now(),'totp');

set local role authenticated;
set local "request.jwt.claims"='{"sub":"66000000-0000-4000-8000-000000000001","session_id":"66100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select is((select manager_mfa_state from public.get_manager_mfa_status()),'setup','verified provider factor is not trusted before atomic registration');
select is(public.register_manager_mfa(),'ready','verified live TOTP session registers factor');
select is(public.register_manager_mfa(),'ready','identical setup retry is idempotent');
select is((select count(*) from public.audit_events where action='manager_mfa.registered'),1::bigint,'registration emits exactly one audit');
select is((select after_data from public.audit_events where action='manager_mfa.registered'),
  '{"state":"registered","factor_type":"totp"}'::jsonb,'registration audit is minimal');
select is((select manager_mfa_state from public.get_manager_mfa_status()),'ready','registered AAL2 session is ready');
select is((select registered_factor_id from public.get_manager_mfa_status()),null::uuid,'ready status does not expose factor id');
select is((select count(*) from public.memberships),2::bigint,'registered AAL2 manager direct table read allowed in tenant');
select ok(jsonb_typeof(public.get_manager_team(gen_random_uuid()))='object','registered AAL2 manager RPC allowed');

set local "request.jwt.claims"='{"sub":"66000000-0000-4000-8000-000000000001","session_id":"66100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1","amr":[{"method":"recovery","timestamp":0}]}';
select is((select manager_mfa_state from public.get_manager_mfa_status()),'verify','password recovery AAL1 cannot bypass registered TOTP');
select is((select count(*) from public.memberships),0::bigint,'password recovery AAL1 loses direct tenant reads');
select throws_ok($$select public.get_manager_team(gen_random_uuid())$$,'42501',null,'password recovery AAL1 loses manager RPC access');

set local "request.jwt.claims"='{"sub":"66000000-0000-4000-8000-000000000001","session_id":"66100000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select is((select manager_mfa_state from public.get_manager_mfa_status()),'ready','fresh AAL2 token restores access after session refresh');
reset role;

insert into auth.mfa_factors(id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret)
values('66500000-0000-4000-8000-000000000002','66000000-0000-4000-8000-000000000001','Replacement TOTP','totp','verified',now(),now(),'different-test-only-secret');
update auth.sessions set factor_id='66500000-0000-4000-8000-000000000002'
where id='66100000-0000-4000-8000-000000000001';
set local role authenticated;
select throws_ok($$select public.register_manager_mfa()$$,'42501','manager_mfa_recovery_required','different factor cannot replace registered factor');
reset role;
select is((select provider_factor_id from private.manager_mfa_registrations where auth_user_id='66000000-0000-4000-8000-000000000001'),
  '66500000-0000-4000-8000-000000000001'::uuid,'failed competing setup preserves first registration');
update auth.sessions set factor_id='66500000-0000-4000-8000-000000000001'
where id='66100000-0000-4000-8000-000000000001';
update auth.mfa_factors set status='unverified' where id='66500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select manager_mfa_state from public.get_manager_mfa_status()),'recovery_required','unverified registered factor enters recovery');
select is((select count(*) from public.memberships),0::bigint,'unverified registered factor fails closed');
reset role;
delete from auth.mfa_factors where id='66500000-0000-4000-8000-000000000001';
set local role authenticated;
select is((select manager_mfa_state from public.get_manager_mfa_status()),'recovery_required','removed registered factor enters recovery');
reset role;
select is((select count(*) from private.manager_mfa_registrations where auth_user_id='66000000-0000-4000-8000-000000000001'),1::bigint,'factor removal does not clear application registration');

select * from finish();
rollback;
