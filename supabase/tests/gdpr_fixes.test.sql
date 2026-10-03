begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
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

select plan(37);

-- Fixtures (rolled back). Org A (sites A1, A2): owner d01, admin d02, manager
-- d03 (manages A1), d04 (A2), admin d05, d06 (A1, clocked 3 days ago, PIN,
-- kiosk), d07 (A1, facts 6 years old), d08 "Dirk Dubbel" (left 6 years ago,
-- still active in org B), d11 (A1, membership already suspended), e10 (never
-- joined: open invitation). Org B: owner d09. Org C: a leaver whose
-- anonymisation fails.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000000d' || lpad(n::text, 2, '0'))::uuid,
  'gdpr-fixes-u' || n || '@example.test'
from generate_series(1, 11) as n
where n <> 10;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-000000000d0a', 'GDPR fixes org A'),
  ('10000000-0000-4000-8000-000000000d0b', 'GDPR fixes org B'),
  ('10000000-0000-4000-8000-000000000d0c', 'GDPR fixes org C');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-000000000da1', '10000000-0000-4000-8000-000000000d0a', 'Site A1'),
  ('20000000-0000-4000-8000-000000000da2', '10000000-0000-4000-8000-000000000d0a', 'Site A2'),
  ('20000000-0000-4000-8000-000000000dc1', '10000000-0000-4000-8000-000000000d0c', 'Site C1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-000000000d' || lpad(n::text, 2, '0'))::uuid, '10000000-0000-4000-8000-000000000d0a',
  ('00000000-0000-4000-8000-000000000d' || lpad(n::text, 2, '0'))::uuid,
  case n when 1 then 'owner' when 2 then 'admin' when 3 then 'manager' when 5 then 'admin' else 'employee' end,
  case when n in (8, 11) then 'suspended' else 'active' end
from generate_series(1, 11) as n
where n not in (9, 10);

insert into public.memberships (organization_id, user_id, role, status) values
  ('10000000-0000-4000-8000-000000000d0b', '00000000-0000-4000-8000-000000000d09', 'owner', 'active'),
  ('10000000-0000-4000-8000-000000000d0b', '00000000-0000-4000-8000-000000000d08', 'employee', 'active');

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-000000000d' || lpad(n::text, 2, '0'))::uuid, '10000000-0000-4000-8000-000000000d0a',
  ('00000000-0000-4000-8000-000000000d' || lpad(n::text, 2, '0'))::uuid,
  case n when 8 then 'Dirk Dubbel' else 'Fixes person ' || n end
from generate_series(1, 11) as n
where n not in (9, 10);

insert into public.employees (id, organization_id, user_id, display_name, active) values
  ('40000000-0000-4000-8000-000000000d10', '10000000-0000-4000-8000-000000000d0a', null, 'Nooit Gekomen', true),
  ('40000000-0000-4000-8000-000000000dc1', '10000000-0000-4000-8000-000000000d0c', null, 'Boom Test', false);

update public.employees
set active = false, left_at = (current_date - interval '6 years')::date
where id in ('40000000-0000-4000-8000-000000000d08', '40000000-0000-4000-8000-000000000dc1');

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da2', '40000000-0000-4000-8000-000000000d04', null),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d06', null),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d07', null),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d08', null),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d11', null),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', null, '30000000-0000-4000-8000-000000000d03');

insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key)
select fact.org::uuid, fact.site::uuid, fact.employee_id::uuid, 'clock_in', now() - fact.age, 'correction',
  '00000000-0000-4000-8000-000000000d01', gen_random_uuid()
from (values
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d06', interval '3 days'),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d07', interval '6 years'),
  ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', '40000000-0000-4000-8000-000000000d08', interval '6 years 1 month'),
  ('10000000-0000-4000-8000-000000000d0c', '20000000-0000-4000-8000-000000000dc1', '40000000-0000-4000-8000-000000000dc1', interval '6 years 1 month')
) as fact (org, site, employee_id, age);

insert into public.correction_requests (id, organization_id, employee_id, requested_by, kind, reason, status,
  decided_by, decided_at, decision_note)
values ('70000000-0000-4000-8000-000000000d61', '10000000-0000-4000-8000-000000000d0a',
  '40000000-0000-4000-8000-000000000d06', '00000000-0000-4000-8000-000000000d06', 'add', 'Vergeten', 'rejected',
  '00000000-0000-4000-8000-000000000d01', now(), 'Nee');

insert into public.employee_pins (employee_id, organization_id, pin_hash, set_by) values
  ('40000000-0000-4000-8000-000000000d06', '10000000-0000-4000-8000-000000000d0a', crypt('1357', gen_salt('bf', 10)),
   '00000000-0000-4000-8000-000000000d06');

insert into public.kiosk_devices (organization_id, site_id, name, secret_hash, created_by)
values ('10000000-0000-4000-8000-000000000d0a', '20000000-0000-4000-8000-000000000da1', 'Kiosk A1',
  digest(decode(repeat('d6', 32), 'hex'), 'sha256'), '00000000-0000-4000-8000-000000000d01');

insert into public.invitations (id, organization_id, email, role, employee_id, invited_by) values
  ('80000000-0000-4000-8000-000000000d10', '10000000-0000-4000-8000-000000000d0a', 'nooit.gekomen@example.test',
   'employee', '40000000-0000-4000-8000-000000000d10', '00000000-0000-4000-8000-000000000d01');

-- Anonymising org C's leaver fails (simulated), so the job must carry on without it.
create function public.gdpr_fixes_boom()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.display_name = 'Boom Test' then
    raise exception 'simulated failure';
  end if;
  return new;
end;
$$;
create trigger gdpr_fixes_boom before update on public.employees
for each row execute function public.gdpr_fixes_boom();

-- Never-joined invitees ------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000d01', '1 minute');
select lives_ok(
  $$select public.rpc_revoke_invitation('80000000-0000-4000-8000-000000000d10')$$,
  'the owner revokes an open invitation'
);
reset role;
select results_eq(
  $$select active, left_at from public.employees where id = '40000000-0000-4000-8000-000000000d10'$$,
  $$values (false, (now() at time zone 'Europe/Brussels')::date)$$,
  'closing an invitation starts the retention clock (left_at today)'
);
-- As if it was closed six years ago.
update public.employees set left_at = (current_date - interval '6 years')::date
where id = '40000000-0000-4000-8000-000000000d10';

-- Scope ----------------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000d03', '1 minute');
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d04')$$,
  '42501', 'not_authorized', 'a manager cannot offboard someone outside their sites'
);
select throws_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000d04')$$,
  '42501', 'not_authorized', 'a manager cannot reinstate someone outside their sites'
);

select pg_temp.login('00000000-0000-4000-8000-000000000d09', '1 minute');
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d06')$$,
  '42501', 'not_authorized', 'another organization''s owner cannot offboard'
);
select throws_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000d08')$$,
  '42501', 'not_authorized', 'another organization''s owner cannot reinstate'
);

select pg_temp.login('00000000-0000-4000-8000-000000000d02', '1 minute');
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d05')$$,
  '42501', 'not_authorized', 'an admin cannot offboard another admin'
);
select pg_temp.login('00000000-0000-4000-8000-000000000d01', '1 minute');
select lives_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d05')$$,
  'the owner offboards an admin'
);

select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d11')$$,
  '55000', 'membership_suspended', 'an already suspended membership is not offboarded'
);

-- Last day bounds ------------------------------------------------------------------------------

select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d06',
      (now() at time zone 'Europe/Brussels')::date - 367)$$,
  '22023', 'invalid_left_at', 'the last day is at most 366 days back'
);
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d06',
      ((now() - interval '3 days') at time zone 'Europe/Brussels')::date - 1)$$,
  '22023', 'left_at_before_last_event', 'the last day cannot lie before the latest clock event'
);

-- Kiosk before offboarding.
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select is(
  (select ok from public.rpc_kiosk_status(repeat('d6', 32), '40000000-0000-4000-8000-000000000d06', '1357')),
  true,
  'before offboarding the kiosk PIN works'
);
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000d01', '1 minute');

select is(
  public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d06',
    ((now() - interval '3 days') at time zone 'Europe/Brussels')::date),
  ((now() - interval '3 days') at time zone 'Europe/Brussels')::date,
  'the day of the latest clock event is a valid last day'
);

reset role;
select is(
  (select count(*)::integer from public.employee_pins where employee_id = '40000000-0000-4000-8000-000000000d06'),
  0,
  'offboarding deletes the kiosk PIN'
);
select is(
  (select metadata -> 'pin_deleted' from public.audit_log
   where action = 'employee.offboarded' and entity_id = '40000000-0000-4000-8000-000000000d06'),
  'true'::jsonb,
  'the audit row says the PIN went'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_status(repeat('d6', 32), '40000000-0000-4000-8000-000000000d06', '1357')$$,
  $$values (false, 'pin_invalid'::text)$$,
  'after offboarding the kiosk refuses the status'
);
select results_eq(
  $$select ok, error_code from public.rpc_kiosk_clock(repeat('d6', 32), '40000000-0000-4000-8000-000000000d06', '1357',
      'clock_in', gen_random_uuid())$$,
  $$values (false, 'pin_invalid'::text)$$,
  'after offboarding the kiosk refuses clocking'
);
reset role;
select is(
  (select count(*)::integer from public.clock_events
   where employee_id = '40000000-0000-4000-8000-000000000d06' and source = 'kiosk'),
  0,
  'no kiosk event was recorded'
);

-- Offboard, reinstate, offboard: the retention clock restarts ----------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000d01', '1 minute');
select lives_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d07')$$,
  'offboarded'
);
select lives_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000d07')$$,
  'reinstated'
);
select lives_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000d07',
      (now() at time zone 'Europe/Brussels')::date - 366)$$,
  'offboarded again, backdated as far as allowed'
);
reset role;

-- Retention ------------------------------------------------------------------------------------

create temporary table run (result jsonb) on commit drop;
insert into run select private.run_retention();

select results_eq(
  $$select (result ->> 'employees_anonymised')::integer, (result ->> 'organizations_failed')::integer from run$$,
  $$values (2, 1)$$,
  'the never-joined invitee and Dirk are anonymised; org C fails on its own'
);
select is(
  (select anonymised_at from public.employees where id = '40000000-0000-4000-8000-000000000d07'),
  null,
  'offboard, reinstate, offboard never anonymises within 5 years of the last day'
);
select results_eq(
  $$select display_name ~ '^Voormalig medewerker ', i.status, i.email like 'nooit%'
    from public.employees as e
    join public.invitations as i on i.employee_id = e.id
    where e.id = '40000000-0000-4000-8000-000000000d10'$$,
  $$values (true, 'anonymised'::text, false)$$,
  'the never-joined invitee is anonymised, invitation email included'
);
select results_eq(
  $$select (select count(*)::integer from auth.users where id = '00000000-0000-4000-8000-000000000d08'),
      (select array_agg(organization_id::text) from public.memberships where user_id = '00000000-0000-4000-8000-000000000d08')$$,
  $$values (1, array['10000000-0000-4000-8000-000000000d0b'])$$,
  'a login with a membership in another org is kept'
);
select results_eq(
  $$select anonymised_at, display_name from public.employees where id = '40000000-0000-4000-8000-000000000dc1'$$,
  $$values (null::timestamptz, 'Boom Test'::text)$$,
  'the failed organization''s work is rolled back'
);
select results_eq(
  $$select action, metadata from public.audit_log
    where organization_id = '10000000-0000-4000-8000-000000000d0c' and action like 'organization.retention%'$$,
  $$values ('organization.retention_failed'::text, '{"errors": 1}'::jsonb)$$,
  'the failure is audited with a count only'
);
select is(
  (select count(*)::integer from public.audit_log
   where organization_id = '10000000-0000-4000-8000-000000000d0a' and action = 'organization.retention_applied'),
  1,
  'the other organization still completed'
);
select is(
  coalesce(current_setting('cloxa.anonymising', true), ''),
  '',
  'the anonymising flag is off after the run'
);
select throws_ok(
  $$update public.correction_requests set reason = null, decision_note = null
    where id = '70000000-0000-4000-8000-000000000d61'$$,
  '55000', 'correction_requests is immutable after decision',
  'outside anonymisation a decided request still cannot lose its reason'
);
select throws_ok(
  $$update public.correction_requests set reason = 'Anders'
    where id = '70000000-0000-4000-8000-000000000d61'$$,
  '55000', 'correction_requests is immutable after decision',
  'nor be given another reason'
);

-- Subject export of an anonymised person ---------------------------------------------------

create temporary table doc (value jsonb) on commit drop;
grant select, insert, delete on doc to authenticated;
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000d01', '1 minute');
insert into doc select public.rpc_subject_export('40000000-0000-4000-8000-000000000d08');
select ok(
  (select value::text !~* 'dirk|dubbel|gdpr-fixes-u8|@example' from doc),
  'the export of an anonymised person holds no name or email'
);
select ok(
  (select value::text !~ '"hash"' and jsonb_array_length(value -> 'clock_events') = 1 from doc),
  'the export keeps the facts but no chain hashes'
);

-- Self export has no hashes either.
select pg_temp.login('00000000-0000-4000-8000-000000000d04');
delete from doc;
insert into doc select public.rpc_my_data_export();
select ok(
  (select value::text !~ '"hash"' from doc),
  'the self export carries no chain hashes'
);

-- Reinstating the admin needs the owner too.
select pg_temp.login('00000000-0000-4000-8000-000000000d02', '1 minute');
select throws_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000d05')$$,
  '42501', 'not_authorized', 'an admin cannot reinstate another admin'
);
select pg_temp.login('00000000-0000-4000-8000-000000000d01', '1 minute');
select lives_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000d05')$$,
  'the owner reinstates the admin'
);
reset role;
select is(
  (select status from public.memberships where id = '30000000-0000-4000-8000-000000000d05'),
  'active',
  'the admin''s membership is active again'
);

select * from finish();
rollback;
