begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

insert into auth.users (
  id, email, email_confirmed_at, encrypted_password, raw_app_meta_data
) values
  (
    '76000000-0000-4000-8000-000000000001',
    'recovery.manager@example.test', now(), 'synthetic-not-a-password',
    '{"cloxa_local_fixture":"manager-mfa-v1"}'::jsonb
  ),
  (
    '76000000-0000-4000-8000-000000000002',
    'recovery.employee@example.test', now(), 'synthetic-not-a-password', '{}'::jsonb
  ),
  (
    '76000000-0000-4000-8000-000000000003',
    'recovery.outsider@example.test', now(), 'synthetic-not-a-password', '{}'::jsonb
  );

insert into public.organizations (id, name, lifecycle_status) values
  ('76100000-0000-4000-8000-000000000001','Recovery organization','research_pilot'),
  ('76100000-0000-4000-8000-000000000002','Other organization','research_pilot');
insert into public.worksites (id,organization_id,name,timezone) values
  ('76200000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','Recovery site','Europe/Brussels'),
  ('76200000-0000-4000-8000-000000000002','76100000-0000-4000-8000-000000000002','Other site','Europe/Brussels');
insert into public.profiles(user_id,display_name) values
  ('76000000-0000-4000-8000-000000000001','Recovery manager'),
  ('76000000-0000-4000-8000-000000000002','Recovery employee'),
  ('76000000-0000-4000-8000-000000000003','Other employee');
insert into public.memberships(id,organization_id,user_id,role,status) values
  ('76300000-0000-4000-8000-000000000001','76100000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000001','manager','active'),
  ('76300000-0000-4000-8000-000000000002','76100000-0000-4000-8000-000000000001','76000000-0000-4000-8000-000000000002','employee','active'),
  ('76300000-0000-4000-8000-000000000003','76100000-0000-4000-8000-000000000002','76000000-0000-4000-8000-000000000003','employee','active');

insert into auth.mfa_factors (
  id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret
) values (
  '76500000-0000-4000-8000-000000000001',
  '76000000-0000-4000-8000-000000000001',
  'Old synthetic factor','totp','verified',now(),now(),'synthetic-old-secret'
);
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal) values
  (
    '76400000-0000-4000-8000-000000000001',
    '76000000-0000-4000-8000-000000000001',
    now(),now(),'76500000-0000-4000-8000-000000000001','aal2'
  ),
  (
    '76400000-0000-4000-8000-000000000002',
    '76000000-0000-4000-8000-000000000002',now(),now(),null,'aal1'
  );
insert into auth.mfa_amr_claims(
  id,session_id,created_at,updated_at,authentication_method
) values (
  '76600000-0000-4000-8000-000000000001',
  '76400000-0000-4000-8000-000000000001',now(),now(),'totp'
);
insert into private.manager_mfa_registrations(auth_user_id,provider_factor_id)
values (
  '76000000-0000-4000-8000-000000000001',
  '76500000-0000-4000-8000-000000000001'
);

select is(
  pg_catalog.to_regclass('private.manager_mfa_recovery_cases'),
  'private.manager_mfa_recovery_cases'::regclass,
  'private recovery case table exists'
);
select is(
  pg_catalog.to_regclass('private.manager_mfa_recovery_candidates'),
  'private.manager_mfa_recovery_candidates'::regclass,
  'private recovery candidate table exists'
);
select ok(
  not has_table_privilege('authenticated','private.manager_mfa_recovery_cases','select'),
  'browser cannot read private recovery cases'
);
select ok(
  not has_table_privilege('service_role','private.manager_mfa_recovery_cases','select'),
  'ordinary service role cannot read private recovery cases'
);
select ok(
  not has_function_privilege(role_name,function_signature,'execute'),
  role_name||' cannot execute local maintenance function '||function_signature
)
from (values ('anon'),('authenticated'),('service_role')) as roles(role_name)
cross join (values
  ('private.start_local_manager_mfa_recovery(uuid,uuid)'),
  ('private.record_local_manager_mfa_provider_result(uuid,uuid,uuid,uuid,boolean)'),
  ('private.get_local_manager_mfa_recovery_status(uuid,uuid)'),
  ('private.complete_local_manager_mfa_recovery(uuid,uuid,uuid,uuid)')
) as functions(function_signature);
select ok(
  has_function_privilege(
    'authenticated',
    'public.record_manager_mfa_recovery_candidate(uuid)',
    'execute'
  ),
  'authenticated browser can call only candidate-recording wrapper'
);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000001","session_id":"76400000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select is((select count(*) from public.memberships),2::bigint,'registered manager starts with tenant access');
select is((select manager_mfa_state from public.get_manager_mfa_status()),'ready','old registered factor is initially ready');

reset role;
select lives_ok(
  $$select private.start_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    '76700000-0000-4000-8000-000000000001'
  )$$,
  'local operator starts bounded recovery case'
);
select is(
  (select count(*) from private.manager_mfa_recovery_cases
   where auth_user_id='76000000-0000-4000-8000-000000000001'),
  1::bigint,
  'one recovery case is created'
);
select is(
  (select expires_at-started_at from private.manager_mfa_recovery_cases
   where start_operation_id='76700000-0000-4000-8000-000000000001'),
  interval '15 minutes',
  'database creates exact 15-minute deadline'
);
select is(
  (select count(*) from public.audit_events
   where action='manager_mfa.recovery_started'
     and actor_user_id is null and actor_type='local_operator'),
  1::bigint,
  'start appends one explicit local-operator audit without manager impersonation'
);

set local role authenticated;
select is((select count(*) from public.memberships),0::bigint,'starting recovery blocks existing aal2 manager access before factor removal');
select throws_ok(
  $$select public.get_manager_team('76800000-0000-4000-8000-000000000001')$$,
  '42501',null,'starting recovery blocks protected manager RPC'
);
reset role;

select is(
  (private.start_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    '76700000-0000-4000-8000-000000000001'
  )->>'case_id')::uuid,
  (select id from private.manager_mfa_recovery_cases
   where start_operation_id='76700000-0000-4000-8000-000000000001'),
  'exact start operation replay returns same case'
);
select throws_ok(
  $$select private.start_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000002',
    '76700000-0000-4000-8000-000000000001'
  )$$,
  '22023','manager_mfa_recovery_operation_reused',
  'altered start operation replay fails'
);

-- Direct Auth writes below are pgTAP provider fixtures only. Application recovery uses
-- supported native Admin listFactors/deleteFactor and browser enroll/challenge/verify.
delete from auth.mfa_factors
where id='76500000-0000-4000-8000-000000000001';
select is(
  private.record_local_manager_mfa_provider_result(
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000001'),
    '76700000-0000-4000-8000-000000000001',
    '76500000-0000-4000-8000-000000000001',true
  )->>'status',
  'awaiting_candidate',
  'provider removal confirmation opens candidate enrollment only'
);
select pg_catalog.set_config(
  'test.recovery_case_id',
  (select id::text from private.manager_mfa_recovery_cases
   where start_operation_id='76700000-0000-4000-8000-000000000001'),
  true
);

insert into auth.mfa_factors (
  id,user_id,friendly_name,factor_type,status,created_at,updated_at,secret
) values (
  '76500000-0000-4000-8000-000000000002',
  '76000000-0000-4000-8000-000000000001',
  'Replacement synthetic factor','totp','unverified',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp(),'synthetic-new-secret'
);
insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal) values (
  '76400000-0000-4000-8000-000000000003',
  '76000000-0000-4000-8000-000000000001',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp(),
  '76500000-0000-4000-8000-000000000002','aal2'
);
insert into auth.mfa_amr_claims(
  id,session_id,created_at,updated_at,authentication_method
) values (
  '76600000-0000-4000-8000-000000000002',
  '76400000-0000-4000-8000-000000000003',now(),now(),'totp'
);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000001","session_id":"76400000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select throws_ok(
  $$select public.record_manager_mfa_recovery_candidate(
    pg_catalog.current_setting('test.recovery_case_id')::uuid
  )$$,
  '42501','manager_mfa_recovery_candidate_denied',
  'unverified factor cannot become candidate despite browser aal claim'
);
reset role;
update auth.mfa_factors set status='verified'
where id='76500000-0000-4000-8000-000000000002';

set local role authenticated;
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000002","session_id":"76400000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","amr":[{"method":"password","timestamp":0}]}';
select throws_ok(
  $$select public.record_manager_mfa_recovery_candidate(
    pg_catalog.current_setting('test.recovery_case_id')::uuid
  )$$,
  '42501','manager_mfa_recovery_candidate_denied',
  'wrong user cannot record candidate for case'
);
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000001","session_id":"76400000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select throws_ok(
  $$select public.record_manager_mfa_recovery_candidate(
    '76900000-0000-4000-8000-000000000001'
  )$$,
  '42501','manager_mfa_recovery_candidate_denied',
  'wrong case cannot record candidate'
);
select lives_ok(
  $$select public.record_manager_mfa_recovery_candidate(
    pg_catalog.current_setting('test.recovery_case_id')::uuid
  )$$,
  'live native session evidence records candidate'
);
reset role;
select is(
  (select count(*) from private.manager_mfa_recovery_candidates),
  1::bigint,
  'candidate retry produces no automatic extra selection'
);
select pg_catalog.set_config(
  'test.recovery_candidate_id',
  (select id::text from private.manager_mfa_recovery_candidates),
  true
);
set local role authenticated;
select lives_ok(
  $$select public.record_manager_mfa_recovery_candidate(
    pg_catalog.current_setting('test.recovery_case_id')::uuid
  )$$,
  'exact candidate recording retry is idempotent'
);
select is((select count(*) from public.memberships),0::bigint,'verified candidate alone grants no business access');
select throws_ok(
  $$select public.get_manager_team('76800000-0000-4000-8000-000000000002')$$,
  '42501',null,'verified candidate alone grants no manager RPC access'
);
reset role;

insert into private.manager_mfa_recovery_candidates (
  id,recovery_case_id,auth_user_id,provider_factor_id,
  auth_session_id,session_created_at,verified_at
) select
  '76900000-0000-4000-8000-000000000002',
  pg_catalog.current_setting('test.recovery_case_id')::uuid,
  '76000000-0000-4000-8000-000000000001',
  '76500000-0000-4000-8000-000000000001',
  id,created_at,pg_catalog.clock_timestamp()
from auth.sessions
where id='76400000-0000-4000-8000-000000000003';
select throws_ok(
  format(
    'select private.complete_local_manager_mfa_recovery(%L,%L,%L,%L)',
    '76000000-0000-4000-8000-000000000001',
    pg_catalog.current_setting('test.recovery_case_id'),
    '76900000-0000-4000-8000-000000000002',
    '76700000-0000-4000-8000-000000000009'
  ),
  '42501','manager_mfa_recovery_completion_denied',
  'operator cannot approve candidate bound to wrong provider factor'
);
delete from private.manager_mfa_recovery_candidates
where id='76900000-0000-4000-8000-000000000002';

create function pg_temp.reject_recovery_completion_audit()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.action = 'manager_mfa.recovery_completed' then
    raise exception 'synthetic completion audit failure';
  end if;
  return new;
end;
$$;
create trigger reject_recovery_completion_audit
before insert on public.audit_events
for each row execute function pg_temp.reject_recovery_completion_audit();

select throws_ok(
  format(
    'select private.complete_local_manager_mfa_recovery(%L,%L,%L,%L)',
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000001'),
    (select id from private.manager_mfa_recovery_candidates),
    '76700000-0000-4000-8000-000000000002'
  ),
  'P0001','synthetic completion audit failure',
  'audit failure aborts completion transaction'
);
select is(
  (select provider_factor_id from private.manager_mfa_registrations
   where auth_user_id='76000000-0000-4000-8000-000000000001'),
  '76500000-0000-4000-8000-000000000001'::uuid,
  'audit failure rolls binding back'
);
select is(
  (select status from private.manager_mfa_recovery_cases
   where start_operation_id='76700000-0000-4000-8000-000000000001'),
  'candidate_verified',
  'audit failure leaves case awaiting explicit completion'
);
drop trigger reject_recovery_completion_audit on public.audit_events;

select is(
  private.complete_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000001'),
    (select id from private.manager_mfa_recovery_candidates),
    '76700000-0000-4000-8000-000000000002'
  )->>'status',
  'completed',
  'operator approves exact candidate atomically'
);
select is(
  (select provider_factor_id from private.manager_mfa_registrations
   where auth_user_id='76000000-0000-4000-8000-000000000001'),
  '76500000-0000-4000-8000-000000000002'::uuid,
  'completion switches only intended binding'
);
select is(
  (select generation from private.manager_mfa_registrations
   where auth_user_id='76000000-0000-4000-8000-000000000001'),
  2::bigint,
  'completion advances binding generation once'
);
select is(
  (select count(*) from public.audit_events
   where action='manager_mfa.recovery_completed'
     and actor_type='local_operator' and actor_user_id is null),
  1::bigint,
  'completion appends one minimal local-operator audit'
);
select is(
  (select after_data from public.audit_events
   where action='manager_mfa.recovery_completed'),
  '{"state":"completed","factor_type":"totp","generation":2}'::jsonb,
  'completion audit excludes session and factor identifiers'
);
select is(
  private.complete_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000001'),
    (select id from private.manager_mfa_recovery_candidates),
    '76700000-0000-4000-8000-000000000002'
  )->>'status',
  'completed',
  'exact completion replay returns stored outcome'
);
select is(
  (select count(*) from public.audit_events
   where action='manager_mfa.recovery_completed'),
  1::bigint,
  'completion replay does not duplicate transition or audit'
);
select throws_ok(
  format(
    'select private.complete_local_manager_mfa_recovery(%L,%L,%L,%L)',
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000001'),
    '76900000-0000-4000-8000-000000000002',
    '76700000-0000-4000-8000-000000000002'
  ),
  '22023','manager_mfa_recovery_operation_reused',
  'altered completion operation replay fails'
);
select is(
  (select registered_factor_id from private.manager_mfa_recovery_cases
   where status='completed'),
  '76500000-0000-4000-8000-000000000001'::uuid,
  'completed case preserves prior registered binding history'
);
select ok(
  (select recovery_case.registration_registered_at < registration.registered_at
   from private.manager_mfa_recovery_cases as recovery_case
   join private.manager_mfa_registrations as registration
     on registration.auth_user_id = recovery_case.auth_user_id
   where recovery_case.status='completed'),
  'completed case preserves prior binding timestamp'
);

set local role authenticated;
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000001","session_id":"76400000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":9999999999}],"exp":9999999999}';
select is((select count(*) from public.memberships),0::bigint,'pre-completion candidate session remains denied after approval');
select is(
  (select recovery_state from public.get_manager_mfa_status()),
  'fresh_login_required',
  'candidate session is instructed to perform fresh login'
);
reset role;
update auth.sessions
set refreshed_at=pg_catalog.clock_timestamp()::timestamp, updated_at=pg_catalog.clock_timestamp()
where id='76400000-0000-4000-8000-000000000003';
set local role authenticated;
select is((select count(*) from public.memberships),0::bigint,'refreshing old session cannot cross database session cutoff');
reset role;

insert into auth.sessions(id,user_id,created_at,updated_at,factor_id,aal)
select
  '76400000-0000-4000-8000-000000000004',
  auth_user_id,
  session_cutoff_at + interval '1 second',
  session_cutoff_at + interval '1 second',
  null,
  'aal1'::auth.aal_level
from private.manager_mfa_registrations
where auth_user_id='76000000-0000-4000-8000-000000000001';
set local role authenticated;
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000001","session_id":"76400000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1","amr":[{"method":"password","timestamp":0}]}';
select is((select manager_mfa_state from public.get_manager_mfa_status()),'verify','fresh login still requires registered replacement factor');
select is((select count(*) from public.memberships),0::bigint,'fresh aal1 login has no manager business access');
reset role;
update auth.sessions
set factor_id='76500000-0000-4000-8000-000000000002',aal='aal2'
where id='76400000-0000-4000-8000-000000000004';
insert into auth.mfa_amr_claims(
  id,session_id,created_at,updated_at,authentication_method
) values (
  '76600000-0000-4000-8000-000000000003',
  '76400000-0000-4000-8000-000000000004',now(),now(),'totp'
);
set local role authenticated;
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000001","session_id":"76400000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal2","amr":[{"method":"totp","timestamp":0}]}';
select is((select manager_mfa_state from public.get_manager_mfa_status()),'ready','fresh login plus replacement TOTP restores manager assurance');
select is((select count(*) from public.memberships),2::bigint,'fresh verified manager remains tenant-isolated');
reset role;
insert into private.manager_mfa_recovery_cases (
  id,auth_user_id,manager_membership_id,organization_id,
  registration_generation,registered_factor_id,registration_registered_at,status,
  start_operation_id,started_at,expires_at
) select
  '76800000-0000-4000-8000-000000000099',
  auth_user_id,'76300000-0000-4000-8000-000000000001',
  '76100000-0000-4000-8000-000000000001',1,
  registered_factor_id,registration_registered_at,'expired',
  '76700000-0000-4000-8000-000000000099',
  expired.started_at,expired.started_at+interval '15 minutes'
from private.manager_mfa_recovery_cases as source_case
cross join (
  select pg_catalog.clock_timestamp()-interval '16 minutes' as started_at
) as expired
where source_case.start_operation_id='76700000-0000-4000-8000-000000000001';
set local role authenticated;
select is(
  (select manager_mfa_state from public.get_manager_mfa_status()),
  'ready',
  'expired older-generation history remains preserved without blocking new binding'
);
set local "request.jwt.claims"='{"sub":"76000000-0000-4000-8000-000000000002","session_id":"76400000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal1","amr":[{"method":"password","timestamp":0}]}';
select is(
  (select authorization_state from public.get_auth_context()),
  'authorized',
  'employee access remains unchanged by manager recovery'
);
reset role;

select lives_ok(
  $$select private.start_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    '76700000-0000-4000-8000-000000000003'
  )$$,
  'another explicit recovery can start from new binding generation'
);
update private.manager_mfa_recovery_cases
set started_at=expired.started_at,
    expires_at=expired.started_at+interval '15 minutes'
from (
  select pg_catalog.clock_timestamp()-interval '16 minutes' as started_at
) as expired
where start_operation_id='76700000-0000-4000-8000-000000000003';
select is(
  private.get_local_manager_mfa_recovery_status(
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000003')
  )->>'status',
  'expired',
  'operator status preserves explicit expired state'
);
select is(
  (select provider_factor_id from private.manager_mfa_registrations
   where auth_user_id='76000000-0000-4000-8000-000000000001'),
  '76500000-0000-4000-8000-000000000002'::uuid,
  'expiry neither erases nor replaces registered binding'
);
select lives_ok(
  $$select private.start_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    '76700000-0000-4000-8000-000000000004'
  )$$,
  'expired case requires and permits another explicit start operation'
);
select is(
  (select count(*) from private.manager_mfa_recovery_cases
   where auth_user_id='76000000-0000-4000-8000-000000000001'
     and status in ('provider_removal_pending','provider_removal_failed','awaiting_candidate','candidate_verified')),
  1::bigint,
  'at most one active case exists per manager'
);
select is(
  private.record_local_manager_mfa_provider_result(
    '76000000-0000-4000-8000-000000000001',
    (select id from private.manager_mfa_recovery_cases
     where start_operation_id='76700000-0000-4000-8000-000000000004'),
    '76700000-0000-4000-8000-000000000004',
    '76500000-0000-4000-8000-000000000002',false
  )->>'status',
  'provider_removal_failed',
  'provider removal failure remains fail-closed and retryable'
);
select is(
  private.start_local_manager_mfa_recovery(
    '76000000-0000-4000-8000-000000000001',
    '76700000-0000-4000-8000-000000000004'
  )->>'status',
  'provider_removal_failed',
  'exact failed start operation resumes same blocked case'
);

select * from finish();
rollback;
