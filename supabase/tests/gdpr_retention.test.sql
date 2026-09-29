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

select plan(59);

-- Fixtures (rolled back). Org A (site A1): owner c01, admin c02, manager c03
-- (manages A1), c04 "Alice Oud" (left 6 years ago, only in A), c05 "Bob Oud"
-- (left 6 years ago, still active in org B), c06 (left 6 years ago, a fact
-- 2 years ago), c07 (still active, old facts), c08 (to offboard), kiosk-only
-- e10 (left 3 years ago). Org B: owner c09, Bob, and an old revoked
-- invitation that still points at Alice's login.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000000c0' || n)::uuid, 'gdpr-u' || n || '@example.test'
from generate_series(1, 9) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-000000000c0a', 'GDPR org A'),
  ('10000000-0000-4000-8000-000000000c0b', 'GDPR org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-000000000ca1', '10000000-0000-4000-8000-000000000c0a', 'Site A1'),
  ('20000000-0000-4000-8000-000000000cb1', '10000000-0000-4000-8000-000000000c0b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-000000000c0' || n)::uuid, '10000000-0000-4000-8000-000000000c0a',
  ('00000000-0000-4000-8000-000000000c0' || n)::uuid,
  case n when 1 then 'owner' when 2 then 'admin' when 3 then 'manager' else 'employee' end,
  case when n in (4, 5, 6) then 'suspended' else 'active' end
from generate_series(1, 8) as n;

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000cb9', '10000000-0000-4000-8000-000000000c0b', '00000000-0000-4000-8000-000000000c09', 'owner', 'active'),
  ('30000000-0000-4000-8000-000000000cb5', '10000000-0000-4000-8000-000000000c0b', '00000000-0000-4000-8000-000000000c05', 'employee', 'active');

insert into public.employees (id, organization_id, user_id, display_name, employee_code)
select ('40000000-0000-4000-8000-000000000c0' || n)::uuid, '10000000-0000-4000-8000-000000000c0a',
  ('00000000-0000-4000-8000-000000000c0' || n)::uuid,
  case n when 4 then 'Alice Oud' when 5 then 'Bob Oud' else 'GDPR person ' || n end,
  case n when 4 then 'ALICE-1' when 5 then 'BOB-1' end
from generate_series(1, 8) as n;

insert into public.employees (id, organization_id, user_id, display_name, employee_code) values
  ('40000000-0000-4000-8000-000000000c10', '10000000-0000-4000-8000-000000000c0a', null, 'Frits Drie', 'FRITS-1'),
  ('40000000-0000-4000-8000-000000000cb5', '10000000-0000-4000-8000-000000000c0b', '00000000-0000-4000-8000-000000000c05', 'Bob in B', null),
  ('40000000-0000-4000-8000-000000000cb9', '10000000-0000-4000-8000-000000000c0b', '00000000-0000-4000-8000-000000000c09', 'Owner B', null),
  ('40000000-0000-4000-8000-000000000cb4', '10000000-0000-4000-8000-000000000c0b', null, 'Alice in B', null);

update public.employees
set active = false,
    left_at = (current_date - interval '6 years')::date
where id in ('40000000-0000-4000-8000-000000000c04', '40000000-0000-4000-8000-000000000c05',
             '40000000-0000-4000-8000-000000000c06');
update public.employees
set active = false,
    left_at = (current_date - interval '3 years')::date
where id = '40000000-0000-4000-8000-000000000c10';

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id)
select '10000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000ca1',
  ('40000000-0000-4000-8000-000000000c0' || n)::uuid, null
from generate_series(1, 8) as n;
insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000ca1', null, '30000000-0000-4000-8000-000000000c03'),
  ('10000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000ca1', '40000000-0000-4000-8000-000000000c10', null);

-- Old facts are appended as correction events: only those keep a past occurred_at.
insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key)
select '10000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000ca1', fact.employee_id::uuid,
  fact.type, now() - fact.age, 'correction', '00000000-0000-4000-8000-000000000c01', gen_random_uuid()
from (values
  ('40000000-0000-4000-8000-000000000c04', 'clock_in', interval '6 years 1 month'),
  ('40000000-0000-4000-8000-000000000c04', 'clock_out', interval '6 years 1 month' - interval '8 hours'),
  ('40000000-0000-4000-8000-000000000c05', 'clock_in', interval '6 years 1 month'),
  ('40000000-0000-4000-8000-000000000c06', 'clock_in', interval '2 years'),
  ('40000000-0000-4000-8000-000000000c07', 'clock_in', interval '6 years'),
  ('40000000-0000-4000-8000-000000000c10', 'clock_in', interval '3 years 1 month')
) as fact (employee_id, type, age);

insert into public.clock_events (id, organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key)
values ('60000000-0000-4000-8000-000000000c81', '10000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000ca1',
  '40000000-0000-4000-8000-000000000c08', 'clock_in', now() - interval '1 day', 'correction',
  '00000000-0000-4000-8000-000000000c01', gen_random_uuid());
insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id,
  idempotency_key, supersedes_event_id)
values ('10000000-0000-4000-8000-000000000c0a', '20000000-0000-4000-8000-000000000ca1',
  '40000000-0000-4000-8000-000000000c08', 'void', now() - interval '1 day', 'correction',
  '00000000-0000-4000-8000-000000000c01', gen_random_uuid(), '60000000-0000-4000-8000-000000000c81');

insert into public.correction_requests (organization_id, employee_id, requested_by, kind, reason, status,
  created_at, decided_by, decided_at, decision_note)
values ('10000000-0000-4000-8000-000000000c0a', '40000000-0000-4000-8000-000000000c04',
  '00000000-0000-4000-8000-000000000c04', 'add', 'Alice was bij de dokter', 'approved',
  now() - interval '6 years', '00000000-0000-4000-8000-000000000c01', now() - interval '6 years', 'Goed, Alice');

insert into public.employee_pins (employee_id, organization_id, pin_hash, set_by) values
  ('40000000-0000-4000-8000-000000000c04', '10000000-0000-4000-8000-000000000c0a', crypt('1357', gen_salt('bf', 10)),
   '00000000-0000-4000-8000-000000000c04'),
  ('40000000-0000-4000-8000-000000000c08', '10000000-0000-4000-8000-000000000c0a', crypt('2468', gen_salt('bf', 10)),
   '00000000-0000-4000-8000-000000000c08');

insert into public.invitations (organization_id, email, role, employee_id, invited_by, status, user_id, membership_id) values
  ('10000000-0000-4000-8000-000000000c0a', 'alice.oud@example.test', 'employee', '40000000-0000-4000-8000-000000000c04',
   '00000000-0000-4000-8000-000000000c01', 'accepted', '00000000-0000-4000-8000-000000000c04',
   '30000000-0000-4000-8000-000000000c04'),
  ('10000000-0000-4000-8000-000000000c0b', 'alice.oud@example.test', 'employee', '40000000-0000-4000-8000-000000000cb4',
   '00000000-0000-4000-8000-000000000c09', 'revoked', '00000000-0000-4000-8000-000000000c04', null);

insert into public.exports (organization_id, period_from, period_to, format_version, created_by, row_count,
  content_sha256, signature, signing_key_id, content)
select '10000000-0000-4000-8000-000000000c0a', (current_date - make_interval(years => age))::date,
  (current_date - make_interval(years => age))::date, 'cloxa.export.v1', '00000000-0000-4000-8000-000000000c01', 0,
  digest(convert_to('{}', 'UTF8'), 'sha256'), decode(repeat('ab', 64), 'hex'), 'gdpr-key', convert_to('{}', 'UTF8')
from unnest(array[7, 4]) as age;

insert into auth.sessions (id, user_id) values
  ('50000000-0000-4000-8000-000000000c81', '00000000-0000-4000-8000-000000000c08');

-- Grants and schedule -------------------------------------------------------------------------

select ok(
  not exists (
    select 1
    from unnest(array[
      'private.run_retention()',
      'private.anonymise_employee(uuid,date)',
      'private.subject_document(uuid)'
    ]) as fn (signature)
    cross join unnest(array['anon', 'authenticated', 'service_role']) as api (role)
    where has_function_privilege(api.role, fn.signature, 'EXECUTE')
  ),
  'no API role can run retention, anonymise or build a subject document'
);

select ok(
  to_regclass('cron.job') is null
  or exists (
    select 1 from cron.job
    where jobname = 'cloxa-retention' and schedule = '15 1 * * *' and command = 'select private.run_retention()'
  ),
  'when pg_cron is present, retention runs daily at 01:15 UTC'
);

-- Retention -----------------------------------------------------------------------------------

-- Even a setting below the legal minimum (impossible through the constraint)
-- never anonymises within 5 years.
alter table public.organizations drop constraint organizations_settings_check;
update public.organizations set settings = settings || '{"retention_years": 1}'
where id = '10000000-0000-4000-8000-000000000c0a';

create temporary table run (result jsonb) on commit drop;
insert into run select private.run_retention();

select is(
  (select result from run),
  '{"employees_anonymised": 2, "exports_purged": 1, "organizations_failed": 0}'::jsonb,
  'one run anonymises the two eligible leavers and purges the old export'
);
select is(
  (select anonymised_at from public.employees where id = '40000000-0000-4000-8000-000000000c10'),
  null,
  'a leaver of 3 years ago is kept, even with retention_years set to 1'
);
select is(
  (select anonymised_at from public.employees where id = '40000000-0000-4000-8000-000000000c06'),
  null,
  'a leaver with a fact newer than the cutoff is kept'
);
select is(
  (select anonymised_at from public.employees where id = '40000000-0000-4000-8000-000000000c07'),
  null,
  'an active employee with only old facts is kept'
);
select is(
  (select count(*)::integer from public.employees
   where id in ('40000000-0000-4000-8000-000000000c04', '40000000-0000-4000-8000-000000000c05')
     and display_name ~ '^Voormalig medewerker [0-9a-f]{6}$'
     and employee_code is null and user_id is null and anonymised_at is not null and not active),
  2,
  'anonymised: "Voormalig medewerker" plus a suffix, no code, no login'
);
select is(
  (select count(*)::integer from public.employees where display_name in ('Alice Oud', 'Bob Oud')),
  0,
  'the names are gone'
);
select results_eq(
  $$select reason, decision_note, status from public.correction_requests
    where employee_id = '40000000-0000-4000-8000-000000000c04'$$,
  $$values (null::text, null::text, 'approved'::text)$$,
  'free-text reason and decision note are cleared, the decision stays'
);
select is(
  (select count(*)::integer from public.employee_pins where employee_id = '40000000-0000-4000-8000-000000000c04'),
  0,
  'the PIN is deleted'
);
select results_eq(
  $$select status, email like 'alice%', user_id, membership_id from public.invitations
    where employee_id = '40000000-0000-4000-8000-000000000c04'$$,
  $$values ('anonymised'::text, false, null::uuid, null::uuid)$$,
  'the invitation loses its email and login link'
);
select is(
  (select user_id from public.invitations where employee_id = '40000000-0000-4000-8000-000000000cb4'),
  null,
  'a closed invitation elsewhere no longer points at the deleted login'
);
select is(
  (select count(*)::integer from auth.users where id = '00000000-0000-4000-8000-000000000c04'),
  0,
  'the login without any other membership is deleted'
);
select results_eq(
  $$select (select count(*)::integer from auth.users where id = '00000000-0000-4000-8000-000000000c05'),
      (select array_agg(organization_id::text || ':' || status) from public.memberships
       where user_id = '00000000-0000-4000-8000-000000000c05')$$,
  $$values (1, array['10000000-0000-4000-8000-000000000c0b:active'])$$,
  'a login with another membership stays; only this org''s membership is removed'
);
select results_eq(
  $$select private.verify_clock_chain('10000000-0000-4000-8000-000000000c0a'),
      private.verify_audit_chain('10000000-0000-4000-8000-000000000c0a')$$,
  $$values (null::uuid, null::uuid)$$,
  'both hash chains still verify after anonymisation'
);
select is(
  (select count(*)::integer from public.clock_events
   where employee_id in ('40000000-0000-4000-8000-000000000c04', '40000000-0000-4000-8000-000000000c05')),
  3,
  'no fact is deleted'
);
select results_eq(
  $$select metadata from public.audit_log where action = 'organization.retention_applied'
    and organization_id = '10000000-0000-4000-8000-000000000c0a'$$,
  $$values (jsonb_build_object('employees_anonymised', 2, 'exports_purged', 1,
      'cutoff', (((now() at time zone 'Europe/Brussels')::date) - interval '5 years')::date))$$,
  'one audit row per org, with counts only'
);
select is(
  (select count(*)::integer from public.audit_log
   where metadata::text ~* 'alice|bob|oud|example\.test'),
  0,
  'no audit row carries a name or email'
);
select is(
  (select array_agg(period_to) from public.exports where signing_key_id = 'gdpr-key'),
  array[(current_date - interval '4 years')::date],
  'the 7-year-old export is purged, the 4-year-old one kept'
);
select is(
  private.run_retention(),
  '{"employees_anonymised": 0, "exports_purged": 0, "organizations_failed": 0}'::jsonb,
  'a second run finds nothing'
);
select is(
  private.anonymise_employee('40000000-0000-4000-8000-000000000c10', current_date),
  false,
  'anonymise_employee refuses a cutoff within the last 5 years'
);

update public.organizations set settings = settings || '{"retention_years": 5}'
where id = '10000000-0000-4000-8000-000000000c0a';
alter table public.organizations add constraint organizations_settings_check check (
  case
    when jsonb_typeof(settings) <> 'object' then false
    when jsonb_typeof(settings -> 'retention_years') is distinct from 'number' then false
    else settings ->> 'location_capture' in ('off', 'clock_points')
      and (settings -> 'retention_years')::numeric >= 5
  end
);

-- Offboarding ---------------------------------------------------------------------------------

set local role authenticated;

select pg_temp.login('00000000-0000-4000-8000-000000000c03', '13 hours');
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c08')$$,
  '42501', 'not_authorized', 'offboarding needs fresh MFA'
);

select pg_temp.login('00000000-0000-4000-8000-000000000c03', '1 minute');
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c02')$$,
  '42501', 'not_authorized', 'a manager cannot offboard an admin'
);

select pg_temp.login('00000000-0000-4000-8000-000000000c02', '1 minute');
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c01')$$,
  '42501', 'cannot_offboard_owner', 'nobody offboards an owner'
);
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c02')$$,
  '42501', 'cannot_offboard_self', 'nobody offboards themselves'
);
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c07', current_date + 2)$$,
  '22023', 'invalid_left_at', 'the last day cannot lie in the future'
);

select pg_temp.login('00000000-0000-4000-8000-000000000c03', '1 minute');
select is(
  public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c08'),
  (now() at time zone 'Europe/Brussels')::date,
  'a manager offboards an employee of a managed site; the last day defaults to today'
);
select throws_ok(
  $$select public.rpc_offboard_employee('40000000-0000-4000-8000-000000000c08')$$,
  '55000', 'already_left', 'offboarding twice is refused'
);

reset role;
select results_eq(
  $$select e.active, e.left_at, m.status,
      (select count(*)::integer from auth.sessions where user_id = '00000000-0000-4000-8000-000000000c08')
    from public.employees as e
    join public.memberships as m on m.organization_id = e.organization_id and m.user_id = e.user_id
    where e.id = '40000000-0000-4000-8000-000000000c08'$$,
  $$values (false, (now() at time zone 'Europe/Brussels')::date, 'suspended'::text, 0)$$,
  'offboarded: inactive, last day set, membership suspended, signed out everywhere'
);
select results_eq(
  $$select action from public.audit_log
    where entity_id = '40000000-0000-4000-8000-000000000c08'
      and actor_user_id = '00000000-0000-4000-8000-000000000c03'
    order by created_at$$,
  $$values ('employee.offboarded'::text), ('member.signed_out_everywhere'::text)$$,
  'offboarding and the sign-out are audited'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000c08');
select throws_ok(
  $$select public.rpc_my_data_export()$$,
  '42501', 'not_authorized', 'an offboarded person has no access'
);
select is(
  (select count(*)::integer from public.employees),
  0,
  'an offboarded person sees no employee rows'
);

select pg_temp.login('00000000-0000-4000-8000-000000000c03', '1 minute');
select lives_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000c08')$$,
  'the manager reinstates the employee'
);
select throws_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000c08')$$,
  '55000', 'not_left', 'reinstating someone in service is refused'
);

reset role;
select results_eq(
  $$select e.active, e.left_at, m.status
    from public.employees as e
    join public.memberships as m on m.organization_id = e.organization_id and m.user_id = e.user_id
    where e.id = '40000000-0000-4000-8000-000000000c08'$$,
  $$values (true, null::date, 'active'::text)$$,
  'reinstated: active again, membership active'
);
select is(
  (select metadata ->> 'status' from public.audit_log
   where action = 'employee.reinstated' and entity_id = '40000000-0000-4000-8000-000000000c08'),
  'active',
  'the reinstatement is audited'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000c01', '1 minute');
select throws_ok(
  $$select public.rpc_reinstate_employee('40000000-0000-4000-8000-000000000c04')$$,
  '55000', 'employee_anonymised', 'an anonymised person cannot be reinstated'
);

-- Data-subject access -------------------------------------------------------------------------

create temporary table doc (value jsonb) on commit drop;
grant select, insert on doc to authenticated;
insert into doc select public.rpc_subject_export('40000000-0000-4000-8000-000000000c08');

select is(
  (select array_agg(key order by key) from doc, jsonb_object_keys(doc.value) as key),
  array['audit_log', 'clock_events', 'correction_requests', 'employee', 'format', 'generated_at',
        'invitations', 'memberships', 'module_data', 'organization', 'pin', 'schedules', 'site_assignments'],
  'the subject export has every section'
);
select results_eq(
  $$select (event ->> 'id')::uuid, (event ->> 'effective')::boolean
    from doc, jsonb_array_elements(doc.value -> 'clock_events') as event
    order by event ->> 'type'$$,
  $$select id, id <> '60000000-0000-4000-8000-000000000c81' from public.clock_events
    where employee_id = '40000000-0000-4000-8000-000000000c08' order by type$$,
  'clock events carry their effective flag'
);
select ok(
  (select value -> 'pin' = 'null'::jsonb and value::text !~ '\$2a\$'
     and not (value -> 'clock_events' -> 0 ? 'hash') from doc),
  'the PIN went with the offboarding; no PIN or chain hash in the export'
);
select ok(
  (select value -> 'audit_log' @> '[{"action": "employee.offboarded"}]'
      and value -> 'memberships' @> '[{"status": "active"}]'
      and value -> 'site_assignments' @> '[{"site_name": "Site A1"}]'
   from doc),
  'audit rows, memberships and site assignments are included'
);
reset role;
select is(
  (select count(*)::integer from public.audit_log
   where action = 'employee.subject_exported' and entity_id = '40000000-0000-4000-8000-000000000c08'
     and actor_user_id = '00000000-0000-4000-8000-000000000c01'),
  1,
  'the subject export is audited'
);
set local role authenticated;

select pg_temp.login('00000000-0000-4000-8000-000000000c01', '13 hours');
select throws_ok(
  $$select public.rpc_subject_export('40000000-0000-4000-8000-000000000c08')$$,
  '42501', 'not_authorized', 'a subject export needs fresh MFA'
);
select pg_temp.login('00000000-0000-4000-8000-000000000c03', '1 minute');
select throws_ok(
  $$select public.rpc_subject_export('40000000-0000-4000-8000-000000000c08')$$,
  '42501', 'not_authorized', 'a manager cannot make a subject export'
);
select pg_temp.login('00000000-0000-4000-8000-000000000c09', '1 minute');
select throws_ok(
  $$select public.rpc_subject_export('40000000-0000-4000-8000-000000000c08')$$,
  '42501', 'not_authorized', 'another organization''s owner is refused'
);

select pg_temp.login('00000000-0000-4000-8000-000000000c08');
delete from doc;
insert into doc select public.rpc_my_data_export();
select results_eq(
  $$select value ->> 'format', jsonb_array_length(value -> 'organizations'),
      value -> 'organizations' -> 0 -> 'employee' ->> 'id'
    from doc$$,
  $$values ('cloxa.my_data_export.v1'::text, 1, '40000000-0000-4000-8000-000000000c08'::text)$$,
  'the employee downloads their own data (aal1 is enough)'
);
reset role;
select is(
  (select count(*)::integer from public.audit_log
   where action = 'employee.self_data_exported' and entity_id = '40000000-0000-4000-8000-000000000c08'),
  1,
  'the self export is audited'
);
set local role authenticated;

-- Org settings --------------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000c02', '1 minute');
select lives_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 7, false, 60, 30)$$,
  'an admin updates the org settings'
);
reset role;
select results_eq(
  $$select settings -> 'retention_years', settings -> 'offline_clocking',
      settings -> 'offline_max_skew_minutes', settings -> 'correction_max_age_days', settings ->> 'location_capture'
    from public.organizations where id = '10000000-0000-4000-8000-000000000c0a'$$,
  $$values ('7'::jsonb, 'false'::jsonb, '60'::jsonb, '30'::jsonb, 'off'::text)$$,
  'the settings are stored and other keys kept'
);
select is(
  (select count(*)::integer from public.audit_log
   where action = 'organization.settings_updated' and entity_id = '10000000-0000-4000-8000-000000000c0a'),
  1,
  'the change is audited'
);
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000c02', '1 minute');

select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 4, true, 240, 60)$$,
  '22023', 'invalid_retention_years', 'retention below 5 years is refused'
);
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 11, true, 240, 60)$$,
  '22023', 'invalid_retention_years', 'retention above 10 years is refused'
);
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, null, 240, 60)$$,
  '22023', 'invalid_offline_clocking', 'offline clocking must be on or off'
);
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, true, 0, 60)$$,
  '22023', 'invalid_offline_max_skew_minutes', 'a skew below 1 minute is refused'
);
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, true, 4321, 60)$$,
  '22023', 'invalid_offline_max_skew_minutes', 'a skew beyond 72 hours is refused'
);
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, true, 240, 0)$$,
  '22023', 'invalid_correction_max_age_days', 'a correction window below 1 day is refused'
);
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, true, 240, 366)$$,
  '22023', 'invalid_correction_max_age_days', 'a correction window beyond 365 days is refused'
);

select pg_temp.login('00000000-0000-4000-8000-000000000c03', '1 minute');
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, true, 240, 60)$$,
  '42501', 'not_authorized', 'a manager cannot change org settings'
);
select pg_temp.login('00000000-0000-4000-8000-000000000c09', '1 minute');
select throws_ok(
  $$select public.rpc_update_org_settings('10000000-0000-4000-8000-000000000c0a', 5, true, 240, 60)$$,
  '42501', 'not_authorized', 'another organization''s owner is refused'
);

select * from finish();
rollback;
