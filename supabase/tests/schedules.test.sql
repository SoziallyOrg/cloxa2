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

select plan(51);

-- Fixtures (rolled back). Org A (Europe/Brussels): owner u1 (A1), manager u2
-- (clocks at and manages A1), employee u3 (A1), employee u4 (A2).
-- Org B: owner u5 (B1).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000040' || n)::uuid, 'schedule-u' || n || '@example.test'
from generate_series(1, 5) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000040a', 'Schedule Org A'),
  ('10000000-0000-4000-8000-00000000040b', 'Schedule Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000004a1', '10000000-0000-4000-8000-00000000040a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000004a2', '10000000-0000-4000-8000-00000000040a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000004b1', '10000000-0000-4000-8000-00000000040b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000040' || n)::uuid,
  case when n = 5 then '10000000-0000-4000-8000-00000000040b' else '10000000-0000-4000-8000-00000000040a' end::uuid,
  ('00000000-0000-4000-8000-00000000040' || n)::uuid,
  (array['owner', 'manager', 'employee', 'employee', 'owner'])[n],
  'active'
from generate_series(1, 5) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000040' || n)::uuid,
  case when n = 5 then '10000000-0000-4000-8000-00000000040b' else '10000000-0000-4000-8000-00000000040a' end::uuid,
  ('00000000-0000-4000-8000-00000000040' || n)::uuid,
  'Schedule employee ' || n
from generate_series(1, 5) as n;

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000040a', '20000000-0000-4000-8000-0000000004a1', '40000000-0000-4000-8000-000000000401', null),
  ('10000000-0000-4000-8000-00000000040a', '20000000-0000-4000-8000-0000000004a1', '40000000-0000-4000-8000-000000000402', null),
  ('10000000-0000-4000-8000-00000000040a', '20000000-0000-4000-8000-0000000004a1', '40000000-0000-4000-8000-000000000403', null),
  ('10000000-0000-4000-8000-00000000040a', '20000000-0000-4000-8000-0000000004a2', '40000000-0000-4000-8000-000000000404', null),
  ('10000000-0000-4000-8000-00000000040b', '20000000-0000-4000-8000-0000000004b1', '40000000-0000-4000-8000-000000000405', null),
  ('10000000-0000-4000-8000-00000000040a', '20000000-0000-4000-8000-0000000004a1', null, '30000000-0000-4000-8000-000000000402');

create temporary table r on commit drop as
select ''::text as label, schedule.* from public.schedules as schedule with no data;
grant select, insert on r to authenticated;

-- Structure ---------------------------------------------------------------------------

select columns_are(
  'public', 'schedules',
  array['id', 'organization_id', 'employee_id', 'version', 'valid_from', 'pattern', 'notified_at', 'created_by', 'created_at'],
  'schedules has the contract columns plus a version number'
);

-- Pattern shape --------------------------------------------------------------------------

select ok(private.is_valid_schedule_pattern('{}'), 'an empty pattern is valid (no planned work)');
select ok(
  private.is_valid_schedule_pattern('{"mon": [{"start": "08:00", "end": "12:00"}, {"start": "12:30", "end": "24:00"}],
    "sat": [{"start": "22:00", "end": "06:00"}], "exceptions": [{"date": "2026-12-24", "blocks": []}]}'),
  'weekday blocks, a 24:00 end, an overnight last block and a day-off exception are valid'
);
select ok(not private.is_valid_schedule_pattern('{"monday": []}'), 'unknown day keys are rejected');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "25:00", "end": "26:00"}]}'), 'hours beyond 23 are rejected');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "24:00", "end": "02:00"}]}'), '24:00 is only valid as an end');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "8:00", "end": "12:00"}]}'), 'times must be HH:MM');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "08:00", "end": "12:00"}, {"start": "11:00", "end": "13:00"}]}'), 'overlapping blocks are rejected');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "22:00", "end": "02:00"}, {"start": "03:00", "end": "04:00"}]}'), 'only the last block may cross midnight');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "08:00", "end": "08:00"}]}'), 'zero-length blocks are rejected');
select ok(not private.is_valid_schedule_pattern('{"mon": [{"start": "08:00", "end": "12:00", "note": "x"}]}'), 'extra block keys are rejected');
select ok(
  not private.is_valid_schedule_pattern(jsonb_build_object('mon', (
    select jsonb_agg(jsonb_build_object('start', lpad(n::text, 2, '0') || ':00', 'end', lpad(n::text, 2, '0') || ':30'))
    from generate_series(1, 7) as n))),
  'more than six blocks per day are rejected'
);
select ok(not private.is_valid_schedule_pattern('{"exceptions": [{"date": "2026-02-30", "blocks": []}]}'), 'impossible exception dates are rejected');
select ok(
  not private.is_valid_schedule_pattern('{"exceptions": [{"date": "2026-12-24", "blocks": []}, {"date": "2026-12-24", "blocks": []}]}'),
  'duplicate exception dates are rejected'
);
select ok(
  not private.is_valid_schedule_pattern(jsonb_build_object('exceptions', (
    select jsonb_agg(jsonb_build_object('date', to_char(date '2026-01-01' + n, 'YYYY-MM-DD'),
      'blocks', '[{"start": "06:00", "end": "07:00"}, {"start": "08:00", "end": "09:00"}, {"start": "10:00", "end": "11:00"},
        {"start": "12:00", "end": "13:00"}, {"start": "14:00", "end": "15:00"}, {"start": "16:00", "end": "17:00"}]'::jsonb))
    from generate_series(0, 99) as n))),
  'patterns above 16 KiB are rejected'
);

-- rpc_set_schedule ------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000402', '1 minute');

insert into r select 'v1', * from public.rpc_set_schedule(
  '40000000-0000-4000-8000-000000000403', current_date, '{"mon": [{"start": "08:00", "end": "16:00"}]}');
insert into r select 'v2', * from public.rpc_set_schedule(
  '40000000-0000-4000-8000-000000000403', current_date + 14, '{"mon": [{"start": "09:00", "end": "17:00"}]}');

select results_eq(
  $$select label, version, created_by, notified_at is not null from r order by version$$,
  $$values ('v1'::text, 1, '00000000-0000-4000-8000-000000000402'::uuid, true), ('v2'::text, 2, '00000000-0000-4000-8000-000000000402'::uuid, true)$$,
  'a manager appends numbered versions for a managed employee'
);
select is(
  (select count(*) from public.schedules where employee_id = '40000000-0000-4000-8000-000000000403'),
  2::bigint, 'the first version is kept next to the second'
);
select results_eq(
  $$select action, entity_id, metadata from public.audit_log where entity = 'schedule' order by created_at$$,
  $$select 'schedule.set'::text, id, jsonb_build_object('employee_id', employee_id, 'version', version, 'valid_from', valid_from)
    from r order by version$$,
  'every version writes one audit row with IDs only'
);

select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000404', current_date, '{}')$$,
  '42501', 'not_authorized', 'a manager cannot schedule an employee of an unmanaged site'
);
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date, '{"mon": [{"start": "12:00", "end": "11:00"}, {"start": "13:00", "end": "14:00"}]}')$$,
  '22023', 'invalid_schedule_pattern', 'an invalid pattern is rejected'
);
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date + 800, '{}')$$,
  '22023', 'invalid_valid_from', 'valid_from more than two years ahead is rejected'
);

select pg_temp.login('00000000-0000-4000-8000-000000000402', '13 hours');
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date, '{}')$$,
  '42501', 'not_authorized', 'stale MFA cannot set a schedule'
);
select pg_temp.login('00000000-0000-4000-8000-000000000402');
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date, '{}')$$,
  '42501', 'not_authorized', 'a manager without aal2 cannot set a schedule'
);
select pg_temp.login('00000000-0000-4000-8000-000000000403', '1 minute');
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date, '{}')$$,
  '42501', 'not_authorized', 'an employee cannot set their own schedule'
);
select pg_temp.login('00000000-0000-4000-8000-000000000405', '1 minute');
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date, '{}')$$,
  '42501', 'not_authorized', 'the owner of org B cannot schedule an org A employee'
);

-- Reads through RLS ------------------------------------------------------------------------

select is((select count(*) from public.schedules where organization_id = '10000000-0000-4000-8000-00000000040a'), 0::bigint, 'org B owner sees no org A schedules');
select pg_temp.login('00000000-0000-4000-8000-000000000403');
select is((select count(*) from public.schedules), 2::bigint, 'employee sees own schedule versions');
select pg_temp.login('00000000-0000-4000-8000-000000000404');
select is((select count(*) from public.schedules), 0::bigint, 'another employee sees none of them');
select pg_temp.login('00000000-0000-4000-8000-000000000402');
select is((select count(*) from public.schedules), 0::bigint, 'manager without aal2 sees no team schedules');
select throws_ok(
  $$insert into public.schedules (organization_id, employee_id, version, valid_from, pattern, created_by)
    values ('10000000-0000-4000-8000-00000000040a', '40000000-0000-4000-8000-000000000403', 9, current_date, '{}', '00000000-0000-4000-8000-000000000402')$$,
  '42501', null, 'authenticated cannot insert schedules directly'
);
reset role;

select throws_ok($$update public.schedules set pattern = '{}'$$, '55000', 'schedules is append-only', 'versions are never overwritten');
select throws_ok($$delete from public.schedules$$, '55000', 'schedules is append-only', 'versions are never deleted');

-- rpc_schedule_for: DST and versions -----------------------------------------------------------
-- Inserted directly so the fixed dates do not depend on today's date.

insert into public.schedules (organization_id, employee_id, version, valid_from, pattern, created_by) values
  ('10000000-0000-4000-8000-00000000040a', '40000000-0000-4000-8000-000000000401', 1, '2026-01-01',
   '{"sat": [{"start": "22:00", "end": "06:00"}],
     "sun": [{"start": "01:00", "end": "05:00"}, {"start": "08:00", "end": "17:00"}]}',
   '00000000-0000-4000-8000-000000000401'),
  ('10000000-0000-4000-8000-00000000040a', '40000000-0000-4000-8000-000000000401', 2, '2027-01-01',
   '{"sat": [{"start": "22:00", "end": "06:00"}],
     "sun": [{"start": "01:00", "end": "05:00"}, {"start": "08:00", "end": "17:00"}],
     "exceptions": [{"date": "2027-01-03", "blocks": []}, {"date": "2027-01-10", "blocks": [{"start": "10:00", "end": "11:00"}]}]}',
   '00000000-0000-4000-8000-000000000401'),
  ('10000000-0000-4000-8000-00000000040a', '40000000-0000-4000-8000-000000000404', 1, '2026-01-01',
   '{"sun": [{"start": "02:00", "end": "03:00"}]}',
   '00000000-0000-4000-8000-000000000401');

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000401', '1 minute');

select results_eq(
  $$select day, start_at, end_at from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2026-10-24', '2026-10-25')$$,
  $$values
    ('2026-10-24'::date, '2026-10-24 20:00Z'::timestamptz, '2026-10-25 05:00Z'::timestamptz),
    ('2026-10-25'::date, '2026-10-24 23:00Z'::timestamptz, '2026-10-25 04:00Z'::timestamptz),
    ('2026-10-25'::date, '2026-10-25 07:00Z'::timestamptz, '2026-10-25 16:00Z'::timestamptz)$$,
  'fall-back day 2026-10-25: the night block lasts 9 hours and 01:00-05:00 lasts 5'
);
select results_eq(
  $$select day, start_at, end_at from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2027-03-27', '2027-03-28')$$,
  $$values
    ('2027-03-27'::date, '2027-03-27 21:00Z'::timestamptz, '2027-03-28 04:00Z'::timestamptz),
    ('2027-03-28'::date, '2027-03-28 00:00Z'::timestamptz, '2027-03-28 03:00Z'::timestamptz),
    ('2027-03-28'::date, '2027-03-28 06:00Z'::timestamptz, '2027-03-28 15:00Z'::timestamptz)$$,
  'spring-forward day 2027-03-28: the night block lasts 7 hours and 01:00-05:00 lasts 3'
);
select results_eq(
  $$select day, start_at, end_at from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2026-12-27', '2027-01-10')$$,
  $$values
    ('2026-12-27'::date, '2026-12-27 00:00Z'::timestamptz, '2026-12-27 04:00Z'::timestamptz),
    ('2026-12-27'::date, '2026-12-27 07:00Z'::timestamptz, '2026-12-27 16:00Z'::timestamptz),
    ('2027-01-02'::date, '2027-01-02 21:00Z'::timestamptz, '2027-01-03 05:00Z'::timestamptz),
    ('2027-01-09'::date, '2027-01-09 21:00Z'::timestamptz, '2027-01-10 05:00Z'::timestamptz),
    ('2027-01-10'::date, '2027-01-10 09:00Z'::timestamptz, '2027-01-10 10:00Z'::timestamptz)$$,
  'the version in force applies per day, and exceptions replace (or clear) a day'
);
select is(
  (select count(*) from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2025-12-01', '2025-12-31')),
  0::bigint, 'no blocks before the first version'
);
select results_eq(
  $$select start_at, end_at from public.rpc_schedule_for('40000000-0000-4000-8000-000000000404', '2026-10-25', '2026-10-25')$$,
  $$values ('2026-10-25 01:00Z'::timestamptz, '2026-10-25 02:00Z'::timestamptz)$$,
  'an ambiguous fall-back time resolves to the later (standard-time) instant'
);
select is(
  (select count(*) from public.rpc_schedule_for('40000000-0000-4000-8000-000000000404', '2027-03-28', '2027-03-28')),
  0::bigint, 'a block inside the spring-forward gap collapses and is dropped'
);
reset role;

insert into public.schedules (organization_id, employee_id, version, valid_from, pattern, created_by) values
  ('10000000-0000-4000-8000-00000000040a', '40000000-0000-4000-8000-000000000401', 3, '2027-01-01', '{}',
   '00000000-0000-4000-8000-000000000401');

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000401');
select is(
  (select count(*) from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2027-01-02', '2027-01-10')),
  0::bigint, 'a later version with the same valid_from wins; the employee reads their own schedule without MFA'
);
select throws_ok(
  $$select * from public.rpc_schedule_for('40000000-0000-4000-8000-000000000403', '2027-01-01', '2027-01-02')$$,
  '42501', 'not_authorized', 'without aal2 an owner reads only their own schedule'
);
select throws_ok(
  $$select * from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2027-01-01', '2027-06-01')$$,
  '22023', 'invalid_range', 'ranges above 93 days are rejected'
);
select throws_ok(
  $$select * from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2027-01-02', '2027-01-01')$$,
  '22023', 'invalid_range', 'an inverted range is rejected'
);
select pg_temp.login('00000000-0000-4000-8000-000000000402', '1 minute');
select is(
  (select count(*) from public.rpc_schedule_for('40000000-0000-4000-8000-000000000403', current_date, current_date + 20)),
  (select count(*) from generate_series(current_date, current_date + 20, interval '1 day') as d where extract(isodow from d) = 1),
  'a manager reads the schedule of a managed employee'
);
select throws_ok(
  $$select * from public.rpc_schedule_for('40000000-0000-4000-8000-000000000404', '2027-01-01', '2027-01-02')$$,
  '42501', 'not_authorized', 'a manager cannot read an unmanaged employee''s schedule'
);
select pg_temp.login('00000000-0000-4000-8000-000000000405', '1 minute');
select throws_ok(
  $$select * from public.rpc_schedule_for('40000000-0000-4000-8000-000000000401', '2027-01-01', '2027-01-02')$$,
  '42501', 'not_authorized', 'org B cannot read org A schedules'
);
reset role;

-- Overnight block inside an exception.
insert into public.schedules (organization_id, employee_id, version, valid_from, pattern, created_by) values
  ('10000000-0000-4000-8000-00000000040a', '40000000-0000-4000-8000-000000000402', 1, '2026-01-01',
   '{"exceptions": [{"date": "2026-12-31", "blocks": [{"start": "22:00", "end": "02:00"}]}]}',
   '00000000-0000-4000-8000-000000000401');
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000402');
select results_eq(
  $$select day, start_at, end_at from public.rpc_schedule_for('40000000-0000-4000-8000-000000000402', '2026-12-30', '2027-01-01')$$,
  $$values ('2026-12-31'::date, '2026-12-31 21:00Z'::timestamptz, '2027-01-01 01:00Z'::timestamptz)$$,
  'an overnight block in an exception ends the next morning'
);
reset role;

-- Timezones must be known IANA names.
select throws_ok(
  $$update public.organizations set timezone = 'Mars/Olympus_Mons' where id = '10000000-0000-4000-8000-00000000040a'$$,
  '22023', 'invalid_timezone', 'an unknown organization timezone is rejected'
);
select throws_ok(
  $$insert into public.organizations (name, timezone) values ('Bad timezone org', 'Europe/Brusels')$$,
  '22023', 'invalid_timezone', 'a misspelled timezone is rejected on insert'
);
select throws_ok(
  $$insert into public.sites (organization_id, name, timezone) values ('10000000-0000-4000-8000-00000000040a', 'Bad', 'CEST+1')$$,
  '22023', 'invalid_timezone', 'an unknown site timezone is rejected'
);
select lives_ok(
  $$update public.sites set timezone = 'Europe/Amsterdam' where id = '20000000-0000-4000-8000-0000000004a2'$$,
  'a known IANA timezone is accepted'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select public.rpc_set_schedule('40000000-0000-4000-8000-000000000403', current_date, '{}')$$,
  '42501', null, 'anon cannot execute rpc_set_schedule'
);
reset role;

select * from finish();
rollback;
