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

select plan(47);

-- Fixtures (rolled back). Org A (offline clocking on by default): owner u1,
-- employee u2 (A1 and the inactive A3; not A2), employee u3 (A1, clocks
-- live). Org B (offline clocking off): employee u4 (B1).
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000070' || n)::uuid, 'offline-u' || n || '@example.test'
from generate_series(1, 4) as n;

insert into public.organizations (id, name, settings) values
  ('10000000-0000-4000-8000-00000000070a', 'Offline Org A', '{"location_capture": "off", "retention_years": 5}'),
  ('10000000-0000-4000-8000-00000000070b', 'Offline Org B',
    '{"location_capture": "off", "retention_years": 5, "offline_clocking": false}');

insert into public.sites (id, organization_id, name, active) values
  ('20000000-0000-4000-8000-0000000007a1', '10000000-0000-4000-8000-00000000070a', 'Site A1', true),
  ('20000000-0000-4000-8000-0000000007a2', '10000000-0000-4000-8000-00000000070a', 'Site A2', true),
  ('20000000-0000-4000-8000-0000000007a3', '10000000-0000-4000-8000-00000000070a', 'Site A3', false),
  ('20000000-0000-4000-8000-0000000007b1', '10000000-0000-4000-8000-00000000070b', 'Site B1', true);

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000070' || n)::uuid,
  case when n = 4 then '10000000-0000-4000-8000-00000000070b' else '10000000-0000-4000-8000-00000000070a' end::uuid,
  ('00000000-0000-4000-8000-00000000070' || n)::uuid,
  case when n = 1 then 'owner' else 'employee' end,
  'active'
from generate_series(1, 4) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000070' || n)::uuid,
  case when n = 4 then '10000000-0000-4000-8000-00000000070b' else '10000000-0000-4000-8000-00000000070a' end::uuid,
  ('00000000-0000-4000-8000-00000000070' || n)::uuid,
  'Offline employee ' || n
from generate_series(1, 4) as n;

insert into public.site_assignments (organization_id, site_id, employee_id) values
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000702'),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a3', '40000000-0000-4000-8000-000000000702'),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703'),
  ('10000000-0000-4000-8000-00000000070b', '20000000-0000-4000-8000-0000000007b1', '40000000-0000-4000-8000-000000000704');

-- RPC results, keyed by label.
create temporary table r (label text, outcome text, event_id uuid, correction_id uuid, reason text) on commit drop;
grant select, insert on r to authenticated;

create function pg_temp.sync(p_label text, p_type text, p_key text, p_site text, p_captured timestamptz)
returns void
language sql
as $$
  insert into r
  select p_label, result.*
  from public.rpc_clock_offline(p_type, p_key::uuid, p_site::uuid, p_captured) as result;
$$;

-- Structure -------------------------------------------------------------------

select col_default_is('public', 'clock_events', 'offline', 'false', 'clock_events.offline defaults to false');
select has_function(
  'public', 'rpc_clock_offline', array['text', 'uuid', 'uuid', 'timestamp with time zone'],
  'rpc_clock_offline takes no employee or source parameter'
);

-- Employee u2 syncs a queue -----------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000702');

-- Older than 72 hours: a request, never a recorded event.
select pg_temp.sync('old', 'clock_out', '50000000-0000-4000-8000-000000000701', '20000000-0000-4000-8000-0000000007a1', now() - interval '73 hours');
select results_eq(
  $$select outcome, event_id, reason from r where label = 'old'$$,
  $$values ('correction_requested'::text, null::uuid, 'outside_window'::text)$$,
  'older than 72 hours: correction requested (outside_window)'
);

-- Just inside the window: recorded at the captured time.
select pg_temp.sync('in', 'clock_in', '50000000-0000-4000-8000-000000000702', '20000000-0000-4000-8000-0000000007a1', now() - interval '71 hours');
select results_eq(
  $$select outcome, correction_id, reason from r where label = 'in'$$,
  $$values ('recorded'::text, null::uuid, null::text)$$,
  'an offline clock_in inside the window is recorded'
);
select results_eq(
  $$select event.occurred_at, event.client_captured_at, event.offline, event.source, event.actor_user_id
    from public.clock_events as event join r on r.event_id = event.id where r.label = 'in'$$,
  $$values (now() - interval '71 hours', now() - interval '71 hours', true, 'app'::text,
    '00000000-0000-4000-8000-000000000702'::uuid)$$,
  'recorded offline: occurred_at = captured time, offline, source app, own actor'
);
select ok(
  (select event.server_at >= now() from public.clock_events as event join r on r.event_id = event.id where r.label = 'in'),
  'server_at is the sync time, so the skew stays visible'
);
select is((select state from public.rpc_my_status()), 'working', 'the offline clock_in sets the state');

-- Earlier than the latest effective event.
select pg_temp.sync('later', 'break_start', '50000000-0000-4000-8000-000000000703', '20000000-0000-4000-8000-0000000007a1', now() - interval '71 hours 30 minutes');
select results_eq(
  $$select outcome, reason from r where label = 'later'$$,
  $$values ('correction_requested'::text, 'later_event_exists'::text)$$,
  'a later event exists: correction requested'
);
select results_eq(
  $$select request.kind, request.status, request.reason, request.offline, request.offline_reason,
      request.requested_by, request.target_event_ids, request.proposed #>> '{events,0,type}',
      (request.proposed #>> '{events,0,occurred_at}')::timestamptz
    from public.correction_requests as request join r on r.correction_id = request.id where r.label = 'later'$$,
  $$values ('add'::text, 'pending'::text, 'Offline geregistreerd'::text, true, 'later_event_exists'::text,
    '00000000-0000-4000-8000-000000000702'::uuid, '{}'::uuid[], 'break_start'::text, now() - interval '71 hours 30 minutes')$$,
  'the request is a pending add at the captured time, marked offline'
);

-- Invalid transition (already working).
select pg_temp.sync('twice', 'clock_in', '50000000-0000-4000-8000-000000000704', '20000000-0000-4000-8000-0000000007a1', now() - interval '2 hours');
select results_eq(
  $$select outcome, reason from r where label = 'twice'$$,
  $$values ('correction_requested'::text, 'invalid_transition'::text)$$,
  'an invalid transition: correction requested'
);

select pg_temp.sync('break', 'break_start', '50000000-0000-4000-8000-000000000705', '20000000-0000-4000-8000-0000000007a1', now() - interval '1 hour');
select is((select outcome from r where label = 'break'), 'recorded', 'a valid later offline event is recorded');
select is((select state from public.rpc_my_status()), 'on_break', 'state follows the offline events');

-- Exactly the instant of an effective event: never two facts at one instant.
select pg_temp.sync('same', 'break_end', '50000000-0000-4000-8000-000000000706', '20000000-0000-4000-8000-0000000007a1', now() - interval '1 hour');
select results_eq(
  $$select outcome, reason from r where label = 'same'$$,
  $$values ('rejected'::text, 'time_conflict'::text)$$,
  'the instant of an existing event is rejected'
);

-- Site in the org but not assigned: the manager decides.
select pg_temp.sync('elsewhere', 'break_end', '50000000-0000-4000-8000-000000000707', '20000000-0000-4000-8000-0000000007a2', now() - interval '30 minutes');
select results_eq(
  $$select outcome, reason from r where label = 'elsewhere'$$,
  $$values ('correction_requested'::text, 'site_not_assigned'::text)$$,
  'a site that is not assigned: correction requested'
);

select pg_temp.sync('inactive', 'break_end', '50000000-0000-4000-8000-000000000708', '20000000-0000-4000-8000-0000000007a3', now() - interval '20 minutes');
select results_eq(
  $$select outcome, reason from r where label = 'inactive'$$,
  $$values ('rejected'::text, 'site_inactive'::text)$$,
  'an inactive site is rejected'
);

select pg_temp.sync('future', 'break_end', '50000000-0000-4000-8000-000000000709', '20000000-0000-4000-8000-0000000007a1', now() + interval '10 minutes');
select results_eq(
  $$select outcome, reason from r where label = 'future'$$,
  $$values ('rejected'::text, 'captured_in_future'::text)$$,
  'a captured time in the future is rejected'
);

select pg_temp.sync('ancient', 'break_end', '50000000-0000-4000-8000-000000000710', '20000000-0000-4000-8000-0000000007a1', now() - interval '61 days');
select results_eq(
  $$select outcome, reason from r where label = 'ancient'$$,
  $$values ('rejected'::text, 'captured_too_old'::text)$$,
  'older than the correction max age is rejected'
);

-- Replays return the original outcome, without a second row.
select pg_temp.sync('in again', 'clock_in', '50000000-0000-4000-8000-000000000702', '20000000-0000-4000-8000-0000000007a1', now() - interval '71 hours');
select results_eq(
  $$select outcome, event_id from r where label = 'in again'$$,
  $$select outcome, event_id from r where label = 'in'$$,
  'replaying a recorded key returns the original event'
);
select pg_temp.sync('later again', 'break_start', '50000000-0000-4000-8000-000000000703', '20000000-0000-4000-8000-0000000007a1', now() - interval '71 hours 30 minutes');
select results_eq(
  $$select outcome, correction_id, reason from r where label = 'later again'$$,
  $$select outcome, correction_id, reason from r where label = 'later'$$,
  'replaying a requested key returns the original request and reason'
);
select is(
  (select count(*) from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000702'),
  1::bigint, 'the replay appended nothing'
);
select is(
  (select count(*) from public.correction_requests where idempotency_key = '50000000-0000-4000-8000-000000000703'),
  1::bigint, 'the replay requested nothing new'
);
select throws_ok(
  $$select * from public.rpc_clock_offline('clock_out', '50000000-0000-4000-8000-000000000702',
    '20000000-0000-4000-8000-0000000007a1', now() - interval '71 hours')$$,
  '22023', 'idempotency_key_reused', 'a key reused for another action is refused'
);

-- Input and tenancy.
select throws_ok(
  $$select * from public.rpc_clock_offline('void', gen_random_uuid(), '20000000-0000-4000-8000-0000000007a1', now())$$,
  '22023', 'invalid_clock_type', 'void is never an offline type'
);
select throws_ok(
  $$select * from public.rpc_clock_offline('break_end', gen_random_uuid(), '20000000-0000-4000-8000-0000000007a1', null)$$,
  '22023', 'invalid_input', 'a captured time is required'
);
select throws_ok(
  $$select * from public.rpc_clock_offline('break_end', gen_random_uuid(), '20000000-0000-4000-8000-0000000007b1', now() - interval '1 minute')$$,
  '42501', 'not_authorized', 'another organization''s site is refused'
);

select is(
  (select count(*) from public.correction_requests where offline),
  4::bigint, 'the employee sees their own offline requests'
);

-- Org B: switched off -----------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000704');
select pg_temp.sync('off', 'clock_in', '50000000-0000-4000-8000-000000000720', '20000000-0000-4000-8000-0000000007b1', now() - interval '5 minutes');
select results_eq(
  $$select outcome, event_id, correction_id, reason from r where label = 'off'$$,
  $$values ('rejected'::text, null::uuid, null::uuid, 'offline_disabled'::text)$$,
  'offline_clocking off: rejected'
);
select is((select count(*) from public.clock_events), 0::bigint, 'nothing was recorded in org B');
select is(
  (select count(*) from public.correction_requests where organization_id = '10000000-0000-4000-8000-00000000070a'),
  0::bigint, 'org B sees none of org A''s offline requests'
);
select throws_ok(
  $$select * from public.rpc_clock_offline('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000007a1', now() - interval '1 minute')$$,
  '42501', 'not_authorized', 'org B cannot clock offline at an org A site'
);

-- A live event of u3 in the same chain ------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000703');
select is(
  (select offline from public.rpc_clock('clock_in', '50000000-0000-4000-8000-000000000730', '20000000-0000-4000-8000-0000000007a1')),
  false, 'live events stay online'
);

-- The owner approves the offline request ------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000701', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select correction_id from r where label = 'elsewhere'), 'approved')),
  'approved', 'an offline request is decided like any other'
);
select is(
  (select count(*) from public.clock_events
   where correction_id = (select correction_id from r where label = 'elsewhere') and source = 'correction' and not offline),
  1::bigint, 'approval appends a correction event'
);
reset role;

-- Audit ---------------------------------------------------------------------------------

select is(
  (select count(*) from public.audit_log
   where organization_id = '10000000-0000-4000-8000-00000000070a'
     and action = 'clock_event.recorded' and (metadata ->> 'offline')::boolean
     and (metadata ->> 'skew_seconds')::bigint >= 0),
  2::bigint, 'each recorded offline event is audited with its skew'
);
select is(
  (select count(*) from public.audit_log
   where organization_id = '10000000-0000-4000-8000-00000000070a'
     and action = 'correction_request.created' and (metadata ->> 'offline')::boolean),
  4::bigint, 'each offline request is audited'
);
select ok(
  not exists (select 1 from public.audit_log where metadata::text like '%Offline geregistreerd%'),
  'the reason text never enters audit metadata'
);

-- The append trigger ----------------------------------------------------------------------

insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id,
  idempotency_key, prev_hash, hash)
values ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703',
  'clock_out', now() - interval '1 hour', 'app', '00000000-0000-4000-8000-000000000703',
  '50000000-0000-4000-8000-000000000740', '\x00', '\x00');
select ok(
  (select occurred_at = server_at from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000740'),
  'a non-offline app event still gets occurred_at = server_at'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, client_captured_at, source,
      actor_user_id, idempotency_key, prev_hash, hash, offline)
    values ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703',
      'clock_in', now() - interval '73 hours', now() - interval '73 hours', 'app', '00000000-0000-4000-8000-000000000703',
      gen_random_uuid(), '\x00', '\x00', true)$$,
  '22023', 'offline_time_out_of_range', 'an offline time older than 72 hours is refused, not moved'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, client_captured_at, source,
      actor_user_id, idempotency_key, prev_hash, hash, offline)
    values ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703',
      'clock_in', now() + interval '1 hour', now() + interval '1 hour', 'app', '00000000-0000-4000-8000-000000000703',
      gen_random_uuid(), '\x00', '\x00', true)$$,
  '22023', 'offline_time_out_of_range', 'an offline time after server_at is refused'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, client_captured_at, source,
      actor_user_id, idempotency_key, prev_hash, hash, offline)
    values ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703',
      'clock_in', now() - interval '1 hour', now() - interval '1 hour', 'kiosk', '00000000-0000-4000-8000-000000000703',
      gen_random_uuid(), '\x00', '\x00', true)$$,
  '22023', 'offline_time_out_of_range', 'only app events can be offline'
);
select throws_ok(
  $$insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source,
      actor_user_id, idempotency_key, prev_hash, hash, offline)
    values ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703',
      'clock_in', now() - interval '1 hour', 'app', '00000000-0000-4000-8000-000000000703',
      gen_random_uuid(), '\x00', '\x00', true)$$,
  '23514', null, 'an offline event must keep its captured time'
);

-- Hash chain with mixed offline and online rows --------------------------------------------

select is(
  (select array[count(*) filter (where offline), count(*) filter (where not offline)]
   from public.clock_events where organization_id = '10000000-0000-4000-8000-00000000070a'),
  array[2, 3]::bigint[], 'org A has offline and online rows in one chain'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000070a'), null, 'the mixed chain verifies');

select is(
  (select hash from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000702'),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from client_captured_at) * 1000000)::bigint)::text
      || '|' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|' || '|offline',
      'UTF8'),
    'sha256') from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000702'),
  'offline rows: the 14 contract fields plus |offline'
);
select is(
  (select hash from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000730'),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || site_id::text || '|' || employee_id::text || '|' || type
      || '|' || ((extract(epoch from occurred_at) * 1000000)::bigint)::text
      || '|' || ((extract(epoch from server_at) * 1000000)::bigint)::text
      || '||' || source || '|' || '|' || '|' || actor_user_id::text || '|' || '|',
      'UTF8'),
    'sha256') from public.clock_events where idempotency_key = '50000000-0000-4000-8000-000000000730'),
  'online rows keep exactly the old canonical bytes (existing hashes stay valid)'
);

alter table public.clock_events disable trigger clock_events_reject_update_delete;
update public.clock_events set offline = false, occurred_at = server_at, client_captured_at = server_at
where idempotency_key = '50000000-0000-4000-8000-000000000705';
select is(
  private.verify_clock_chain('10000000-0000-4000-8000-00000000070a'),
  (select event_id from r where label = 'break'),
  'passing an offline event off as live is detected'
);
alter table public.clock_events enable trigger clock_events_reject_update_delete;

-- Anonymous --------------------------------------------------------------------------------

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.rpc_clock_offline('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000007a1', now())$$,
  '42501', null, 'anon cannot clock offline'
);
reset role;

select * from finish();
rollback;
