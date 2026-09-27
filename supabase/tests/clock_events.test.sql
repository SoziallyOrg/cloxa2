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

select plan(98);

-- Fixtures (rolled back). Org A: owner u1 (A1), manager u2 (clocks at and
-- manages A1), employee u3 (A1), employee u4 (A2), suspended u5 (A1).
-- Org B: owner u6 (B1).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000020' || n)::uuid, 'clock-u' || n || '@example.test'
from generate_series(1, 6) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000020a', 'Clock Org A'),
  ('10000000-0000-4000-8000-00000000020b', 'Clock Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000002a1', '10000000-0000-4000-8000-00000000020a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000002a2', '10000000-0000-4000-8000-00000000020a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000002b1', '10000000-0000-4000-8000-00000000020b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000020' || n)::uuid,
  case when n = 6 then '10000000-0000-4000-8000-00000000020b' else '10000000-0000-4000-8000-00000000020a' end::uuid,
  ('00000000-0000-4000-8000-00000000020' || n)::uuid,
  (array['owner', 'manager', 'employee', 'employee', 'employee', 'owner'])[n],
  case when n = 5 then 'suspended' else 'active' end
from generate_series(1, 6) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000020' || n)::uuid,
  case when n = 6 then '10000000-0000-4000-8000-00000000020b' else '10000000-0000-4000-8000-00000000020a' end::uuid,
  ('00000000-0000-4000-8000-00000000020' || n)::uuid,
  'Clock employee ' || n
from generate_series(1, 6) as n;

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000201', null),
  ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000202', null),
  ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000203', null),
  ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a2', '40000000-0000-4000-8000-000000000204', null),
  ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000205', null),
  ('10000000-0000-4000-8000-00000000020b', '20000000-0000-4000-8000-0000000002b1', '40000000-0000-4000-8000-000000000206', null),
  ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', null, '30000000-0000-4000-8000-000000000202');

-- RPC results, keyed by label.
create temporary table r on commit drop as
select ''::text as label, event.* from public.clock_events as event with no data;
grant select, insert on r to authenticated;

-- Structure -------------------------------------------------------------------

select columns_are(
  'public', 'clock_events',
  array[
    'id', 'organization_id', 'site_id', 'employee_id', 'type', 'occurred_at', 'server_at',
    'client_captured_at', 'source', 'device_id', 'geo', 'supersedes_event_id', 'correction_id',
    'actor_user_id', 'idempotency_key', 'prev_hash', 'hash'
  ],
  'clock_events has exactly the contract columns'
);
select has_index(
  'public', 'clock_events', 'clock_events_employee_occurred_at_idx',
  array['organization_id', 'employee_id', 'occurred_at'], 'index on (organization_id, employee_id, occurred_at)'
);
select col_is_unique('public', 'clock_events', array['organization_id', 'employee_id', 'idempotency_key'], 'idempotency key is unique per employee');
select has_function('public', 'rpc_clock', array['text', 'uuid', 'uuid', 'timestamp with time zone'], 'rpc_clock has no source or employee parameter');

-- Live clocking as employee u3 (aal1) --------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000203');

insert into r select 'k1', * from public.rpc_clock(
  'clock_in', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000002a1', now() - interval '71 hours');

select results_eq(
  $$select type, employee_id, site_id, source, actor_user_id from r where label = 'k1'$$,
  $$values ('clock_in'::text, '40000000-0000-4000-8000-000000000203'::uuid, '20000000-0000-4000-8000-0000000002a1'::uuid,
    'app'::text, '00000000-0000-4000-8000-000000000203'::uuid)$$,
  'clock_in is recorded for the caller''s own employee row'
);
select ok((select occurred_at = server_at from r where label = 'k1'), 'live event: occurred_at = server_at');
select ok((select server_at > now() - interval '1 minute' from r where label = 'k1'), 'occurred_at is server time, not client time');
select is((select client_captured_at from r where label = 'k1'), now() - interval '71 hours', 'client time is stored only as client_captured_at');

select results_eq(
  $$select state, last_event_id, open_shift_started_at from public.rpc_my_status()$$,
  $$select 'working'::text, id, occurred_at from r where label = 'k1'$$,
  'my_status: working, last event and open shift start'
);

-- Idempotency.
insert into r select 'k1-replay', * from public.rpc_clock(
  'clock_in', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000002a1');
select is((select id from r where label = 'k1-replay'), (select id from r where label = 'k1'), 'same key returns the same event');
select is(
  (select count(*) from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000001'),
  1::bigint, 'replay does not append a duplicate'
);
select throws_ok(
  $$select public.rpc_clock('clock_out', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000002a1')$$,
  '22023', 'idempotency_key_reused', 'same key with a different payload is rejected'
);

-- Transitions.
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'double clock_in is rejected'
);
select throws_ok(
  $$select public.rpc_clock('break_end', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'break_end without break_start is rejected'
);
insert into r select 'k2', * from public.rpc_clock(
  'break_start', '50000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-0000000002a1');
select is((select type from r where label = 'k2'), 'break_start', 'working -> break_start');
select throws_ok(
  $$select public.rpc_clock('clock_out', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'clock_out while on break is rejected'
);
select throws_ok(
  $$select public.rpc_clock('break_start', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'break_start while on break is rejected'
);
select results_eq(
  $$select state, last_event_id, open_shift_started_at from public.rpc_my_status()$$,
  $$select 'on_break'::text, (select id from r where label = 'k2'), (select occurred_at from r where label = 'k1')$$,
  'my_status: on_break keeps the open shift start'
);
insert into r select 'k3', * from public.rpc_clock(
  'break_end', '50000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-0000000002a1');
select is((select type from r where label = 'k3'), 'break_end', 'on_break -> break_end');
insert into r select 'k4', * from public.rpc_clock(
  'clock_out', '50000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-0000000002a1');
select is((select type from r where label = 'k4'), 'clock_out', 'working -> clock_out');
select throws_ok(
  $$select public.rpc_clock('clock_out', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'clock_out when off is rejected'
);
select throws_ok(
  $$select public.rpc_clock('break_start', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'break_start when off is rejected'
);
select results_eq(
  $$select state, last_event_id, open_shift_started_at from public.rpc_my_status()$$,
  $$select 'off'::text, id, null::timestamptz from r where label = 'k4'$$,
  'my_status: off after clock_out'
);

-- Inputs the live RPC never accepts.
select throws_ok(
  $$select public.rpc_clock('void', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '22023', 'invalid_clock_type', 'void is not a live clock type'
);
select throws_ok(
  $$select public.rpc_clock('correction', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '22023', 'invalid_clock_type', 'correction is not a live clock type'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', null, '20000000-0000-4000-8000-0000000002a1')$$,
  '22023', 'invalid_input', 'idempotency key is required'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1', now() - interval '73 hours')$$,
  '22023', 'client_time_out_of_range', 'client time older than 72 hours is rejected'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1', now() + interval '6 minutes')$$,
  '22023', 'client_time_out_of_range', 'client time more than 5 minutes ahead is rejected'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1', 'infinity')$$,
  '22023', 'client_time_out_of_range', 'client time infinity is rejected'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1', '-infinity')$$,
  '22023', 'client_time_out_of_range', 'client time -infinity is rejected'
);

-- Sites and identity.
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a2')$$,
  '42501', 'site_not_assigned', 'employee cannot clock at an unassigned site'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002b1')$$,
  '42501', 'not_authorized', 'employee cannot clock at another org''s site'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), gen_random_uuid())$$,
  '42501', 'not_authorized', 'unknown site looks the same as a foreign site'
);
select throws_ok(
  $$select private.clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '42501', null, 'the private implementation is not executable by authenticated'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a2', '40000000-0000-4000-8000-000000000204',
      'clock_in', now(), 'app', '00000000-0000-4000-8000-000000000203', gen_random_uuid(), '\x00', '\x00')$$,
  '42501', null, 'employee cannot insert an event for another employee'
);
select is((select count(*) from public.clock_events), 4::bigint, 'employee sees exactly own four events; rejected calls appended nothing');

-- Employee u4 at A2 reuses u3's key: keys are scoped per employee.
select pg_temp.login('00000000-0000-4000-8000-000000000204');
insert into r select 'k5', * from public.rpc_clock(
  'clock_in', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000002a2', now() + interval '4 minutes');
select results_eq(
  $$select employee_id, type, id <> (select id from r where label = 'k1') from r where label = 'k5'$$,
  $$values ('40000000-0000-4000-8000-000000000204'::uuid, 'clock_in'::text, true)$$,
  'another employee''s key creates an independent event, never a replay'
);
select is(
  (select count(*) from public.clock_events where employee_id <> '40000000-0000-4000-8000-000000000204'),
  0::bigint, 'employee u4 sees none of u3''s events'
);
select is(
  (select count(*) from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000001'),
  1::bigint, 'employee u4 sees only own event for the shared key'
);
select pg_temp.login('00000000-0000-4000-8000-000000000203');
select results_eq(
  $$select id from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000001'$$,
  $$select id from r where label = 'k1'$$,
  'employee u3 sees only own event for the shared key'
);
select pg_temp.login('00000000-0000-4000-8000-000000000204');

-- Suspended u5, sessionless, service_role and anonymous callers.
select pg_temp.login('00000000-0000-4000-8000-000000000205');
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '42501', 'not_authorized', 'suspended member cannot clock'
);
select is((select count(*) from public.rpc_my_status()), 0::bigint, 'suspended member has no clock status');
set local "request.jwt.claims" = '{"role":"authenticated"}';
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '42501', 'not_authorized', 'caller without a user id cannot clock'
);
reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '42501', null, 'service_role cannot execute rpc_clock'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'), null, 'service_role can run the clock verification');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  '42501', null, 'anon cannot execute rpc_clock'
);
select throws_ok($$select * from public.rpc_my_status()$$, '42501', null, 'anon cannot execute rpc_my_status');
reset role;

-- Org B owner u6 reuses u3's key: keys are scoped per org.
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000206');
insert into r select 'k6', * from public.rpc_clock(
  'clock_in', '50000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-0000000002b1');
select is((select organization_id from r where label = 'k6'), '10000000-0000-4000-8000-00000000020b'::uuid, 'the same key is independent in another org');

-- Visibility ------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000202', '1 minute');
select is(
  (select count(*) from public.clock_events where employee_id = '40000000-0000-4000-8000-000000000203'),
  4::bigint, 'manager with aal2 sees events of employees on the managed site'
);
select is(
  (select count(*) from public.clock_events where employee_id = '40000000-0000-4000-8000-000000000204'),
  0::bigint, 'manager does not see events of an unmanaged site'
);
select pg_temp.login('00000000-0000-4000-8000-000000000202');
select is((select count(*) from public.clock_events), 0::bigint, 'manager without aal2 sees no team events');

select pg_temp.login('00000000-0000-4000-8000-000000000201', '1 minute');
select is((select count(*) from public.clock_events), 5::bigint, 'owner with aal2 sees every event of own org only');

select pg_temp.login('00000000-0000-4000-8000-000000000206', '1 minute');
select is(
  (select count(*) from public.clock_events where organization_id = '10000000-0000-4000-8000-00000000020a'),
  0::bigint, 'owner of org B sees no events of org A'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000203',
      'clock_in', now(), 'app', '00000000-0000-4000-8000-000000000206', gen_random_uuid(), '\x00', '\x00')$$,
  '42501', null, 'owner of org B cannot insert events into org A'
);

-- Append-only, for privileged users ...
select pg_temp.login('00000000-0000-4000-8000-000000000201', '1 minute');
select throws_ok($$update public.clock_events set type = 'clock_out'$$, '42501', null, 'privileged user cannot update events');
select throws_ok($$delete from public.clock_events$$, '42501', null, 'privileged user cannot delete events');
select throws_ok($$truncate public.clock_events$$, '42501', null, 'privileged user cannot truncate events');
reset role;

-- ... and for the table owner, through the triggers.
select throws_ok($$update public.clock_events set type = 'clock_out'$$, '55000', 'clock_events is append-only', 'owner cannot update events');
select throws_ok($$delete from public.clock_events$$, '55000', 'clock_events is append-only', 'owner cannot delete events');
select throws_ok($$truncate public.clock_events$$, '55000', 'clock_events is append-only', 'owner cannot truncate events');
select throws_ok(
  $$insert into public.clock_events (id, organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash)
    select id, organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, gen_random_uuid(), prev_hash, hash
    from r where label = 'k1'
    on conflict (id) do update set type = 'clock_out'$$,
  '55000', 'clock_events is append-only', 'INSERT ... ON CONFLICT DO UPDATE cannot rewrite an event'
);

-- Audit: one row per successful mutation, none for replays or rejections ----------

select is(
  (select count(*) from public.clock_events as event
   where (select count(*) from public.audit_log as log
          where log.entity = 'clock_event' and log.entity_id = event.id) <> 1),
  0::bigint, 'every event has exactly one audit row'
);
select is(
  (select count(*) from public.audit_log where organization_id = '10000000-0000-4000-8000-00000000020a'),
  5::bigint, 'org A audit holds exactly the five recorded events'
);
select results_eq(
  $$select action, actor_user_id, metadata from public.audit_log where entity_id = (select id from r where label = 'k1')$$,
  $$values ('clock_event.recorded'::text, '00000000-0000-4000-8000-000000000203'::uuid,
    '{"type": "clock_in", "source": "app", "site_id": "20000000-0000-4000-8000-0000000002a1", "employee_id": "40000000-0000-4000-8000-000000000203"}'::jsonb)$$,
  'audit row carries actor and IDs only'
);
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000020a'), null, 'audit chain of org A verifies');

-- Structural guards on events that only correction approval may append -------------

select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000203',
      'void', now(), 'correction', '00000000-0000-4000-8000-000000000201', gen_random_uuid(), '\x00', '\x00')$$,
  '23514', null, 'a void must supersede an event'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, supersedes_event_id, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000203',
      'clock_out', now(), 'app', '00000000-0000-4000-8000-000000000201', gen_random_uuid(), (select id from r where label = 'k4'), '\x00', '\x00')$$,
  '23514', null, 'only corrections may supersede'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, geo, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002a1', '40000000-0000-4000-8000-000000000203',
      'clock_in', now(), 'app', '00000000-0000-4000-8000-000000000201', gen_random_uuid(), '{"lat": 51, "lng": 4, "path": []}', '\x00', '\x00')$$,
  '23514', null, 'geo holds a single point only'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000020a', '20000000-0000-4000-8000-0000000002b1', '40000000-0000-4000-8000-000000000203',
      'clock_in', now(), 'app', '00000000-0000-4000-8000-000000000201', gen_random_uuid(), '\x00', '\x00')$$,
  '23503', null, 'an event cannot reference another org''s site'
);

-- Hash chain -------------------------------------------------------------------------

create temporary table chain_a on commit drop as
select event.*, row_number() over (order by event.server_at) as position
from public.clock_events as event
where event.organization_id = '10000000-0000-4000-8000-00000000020a';
grant select on chain_a to authenticated;

select is(
  (select prev_hash from chain_a where position = 1),
  '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea,
  'first event of an org chains from 32 zero bytes'
);
select is(
  (select count(*) from chain_a as cur join chain_a as prev on prev.position = cur.position - 1 where cur.prev_hash = prev.hash),
  4::bigint, 'each later event links to its predecessor (chain order = server_at order)'
);
select is(
  (select hash from chain_a where position = 1),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from client_captured_at) * 1000000)::bigint)::text
      || '|' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|',
      'UTF8'),
    'sha256') from chain_a where position = 1),
  'hash = sha256(prev_hash || contract canonical bytes), client time included'
);
select is(
  (select hash from chain_a where position = 2),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '||' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|',
      'UTF8'),
    'sha256') from chain_a where position = 2),
  'canonical bytes encode a null client time as empty'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'), null, 'valid chain of org A verifies');
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020b'), null, 'valid chain of org B verifies');

-- concat_ws skips nulls; every nullable field must still occupy its slot.
select is(
  (select length(c) - length(replace(c, '|', ''))
   from (select private.clock_event_canonical(row(
     gen_random_uuid(), '10000000-0000-4000-8000-00000000020a', gen_random_uuid(), gen_random_uuid(), 'clock_in', now(), now(),
     null, 'app', null, null, null, null, gen_random_uuid(), gen_random_uuid(), null, null
   )::public.clock_events) as c) as canonical),
  13, 'canonical bytes keep all 14 fields (13 separators) when nullable fields are null'
);
select isnt(
  private.clock_event_canonical((select row(e.id, e.organization_id, e.site_id, e.employee_id, e.type, e.occurred_at, e.server_at,
    e.client_captured_at, e.source, '60000000-0000-4000-8000-000000000001'::uuid, '{"lat": 51.2, "lng": 4.4}'::jsonb,
    e.supersedes_event_id, e.correction_id, e.actor_user_id, e.idempotency_key, e.prev_hash, e.hash)::public.clock_events
    from chain_a as e where position = 1)),
  private.clock_event_canonical((select row(e.id, e.organization_id, e.site_id, e.employee_id, e.type, e.occurred_at, e.server_at,
    e.client_captured_at, e.source, e.device_id, e.geo, e.supersedes_event_id, e.correction_id, e.actor_user_id,
    e.idempotency_key, e.prev_hash, e.hash)::public.clock_events from chain_a as e where position = 1)),
  'device_id and geo are part of the canonical bytes'
);

-- On-demand verification: owners with fresh MFA only, audited.
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000201', '1 minute');
select results_eq(
  $$select * from public.rpc_verify_chains('10000000-0000-4000-8000-00000000020a')$$,
  $$values (null::uuid, null::uuid)$$,
  'owner with fresh MFA verifies both chains of own org'
);
select results_eq(
  $$select actor_user_id, metadata from public.audit_log where action = 'integrity.chains_verified'$$,
  $$values ('00000000-0000-4000-8000-000000000201'::uuid, '{"audit_chain_ok": true, "clock_chain_ok": true}'::jsonb)$$,
  'chain verification writes an audit row'
);
select pg_temp.login('00000000-0000-4000-8000-000000000201', '13 hours');
select throws_ok($$select * from public.rpc_verify_chains('10000000-0000-4000-8000-00000000020a')$$, '42501', 'not_authorized', 'owner with stale MFA cannot verify');
select pg_temp.login('00000000-0000-4000-8000-000000000202', '1 minute');
select throws_ok($$select * from public.rpc_verify_chains('10000000-0000-4000-8000-00000000020a')$$, '42501', 'not_authorized', 'manager cannot verify chains');
select pg_temp.login('00000000-0000-4000-8000-000000000206', '1 minute');
select throws_ok($$select * from public.rpc_verify_chains('10000000-0000-4000-8000-00000000020a')$$, '42501', 'not_authorized', 'owner of org B cannot verify org A');
reset role;

-- Effective events: a correction void supersedes the clock_out ------------------------

insert into public.clock_events (
  organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, supersedes_event_id,
  prev_hash, hash
)
select organization_id, site_id, employee_id, 'void', occurred_at, 'correction', '00000000-0000-4000-8000-000000000201',
  '50000000-0000-4000-8000-000000000099', id, '\x00', '\x00'
from r where label = 'k4';

select results_eq(
  $$select occurred_at from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000099'$$,
  $$select occurred_at from r where label = 'k4'$$,
  'correction events keep their approved occurred_at'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000203');
select results_eq(
  $$select state, last_event_id, open_shift_started_at from public.rpc_my_status()$$,
  $$select 'working'::text, (select id from r where label = 'k3'), (select occurred_at from r where label = 'k1')$$,
  'a voided clock_out is no longer effective: back to working'
);
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000002a1')$$,
  'P0001', 'invalid_transition', 'transitions follow effective events only'
);
insert into r select 'k7', * from public.rpc_clock(
  'clock_out', '50000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-0000000002a1');
select is((select type from r where label = 'k7'), 'clock_out', 'clock_out is valid again after the void');
reset role;

select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, supersedes_event_id, prev_hash, hash)
    select organization_id, site_id, employee_id, 'void', occurred_at, 'correction', '00000000-0000-4000-8000-000000000201',
      gen_random_uuid(), id, '\x00', '\x00' from r where label = 'k4'$$,
  '23505', null, 'an event is superseded at most once'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'), null, 'chain still verifies after corrections');

-- Tampering (as superuser, trigger disabled) is detected -------------------------------

alter table public.clock_events disable trigger clock_events_reject_update_delete;

update public.clock_events set occurred_at = occurred_at - interval '1 hour'
where id = (select id from chain_a where position = 2);
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'),
  (select id from chain_a where position = 2),
  'a shifted occurred_at is reported at the tampered event'
);
update public.clock_events as event set occurred_at = original.occurred_at
from chain_a as original where original.position = 2 and event.id = original.id;
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'), null, 'restored chain verifies again');

update public.clock_events set employee_id = '40000000-0000-4000-8000-000000000201'
where id = (select id from chain_a where position = 3);
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'),
  (select id from chain_a where position = 3),
  'reassigning an event to another employee is detected'
);
update public.clock_events as event set employee_id = original.employee_id
from chain_a as original where original.position = 3 and event.id = original.id;

update public.clock_events set geo = '{"lat": 50.85, "lng": 4.35}'
where id = (select id from chain_a where position = 2);
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'),
  (select id from chain_a where position = 2),
  'adding a location afterwards is detected'
);
update public.clock_events set geo = null, device_id = '60000000-0000-4000-8000-000000000001'
where id = (select id from chain_a where position = 2);
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'),
  (select id from chain_a where position = 2),
  'changing the device afterwards is detected'
);
update public.clock_events set device_id = null
where id = (select id from chain_a where position = 2);
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'), null, 'chain verifies after restoring geo and device');

-- position 4 (the voided clock_out) is FK-referenced, so delete position 3.
delete from public.clock_events where id = (select id from chain_a where position = 3);
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000020a'),
  (select id from chain_a where position = 4),
  'a deleted event is reported at its successor'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000201', '1 minute');
select results_eq(
  $$select * from public.rpc_verify_chains('10000000-0000-4000-8000-00000000020a')$$,
  $$select id, null::uuid from chain_a where position = 4$$,
  'rpc_verify_chains reports the broken clock event to the owner'
);
reset role;

alter table public.clock_events enable trigger clock_events_reject_update_delete;

select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000020b'), null, 'tampering in org A does not affect org B');

-- The chain head table has no guard trigger; edits to it are still caught.
update private.hash_chain_heads set head_hash = extensions.digest('forged', 'sha256')
where organization_id = '10000000-0000-4000-8000-00000000020b' and chain = 'clock_events';
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000020b'),
  (select head_id from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000020b' and chain = 'clock_events'),
  'a tampered head hash is reported'
);

select * from finish();
rollback;
