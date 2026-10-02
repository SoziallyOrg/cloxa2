begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

-- Sign in as p_sub for the rest of the transaction. Without p_mfa_age: aal1
-- (email code only). With p_mfa_age: aal2 with a TOTP verified that long ago.
create function pg_temp.login(p_sub text, p_mfa_age interval default null)
returns void
language plpgsql
as $$
declare
  v_now bigint := extract(epoch from now())::bigint;
begin
  perform set_config('request.jwt.claims', jsonb_build_object(
    'sub', p_sub,
    'role', 'authenticated',
    'aal', case when p_mfa_age is null then 'aal1' else 'aal2' end,
    'amr', case
      when p_mfa_age is null then jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', v_now))
      else jsonb_build_array(
        jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now() - p_mfa_age)::bigint),
        jsonb_build_object('method', 'otp', 'timestamp', v_now))
    end
  )::text, true);
end;
$$;

-- proposed = {"events": [{type, occurred_at = now() - ago, site_id}, ...]} for kind 'add'.
create function pg_temp.add_events(p_site uuid, variadic p_items text[])
returns jsonb
language sql
as $$
  select jsonb_build_object('events', jsonb_agg(jsonb_build_object(
    'type', split_part(item, '@', 1),
    'occurred_at', now() - split_part(item, '@', 2)::interval,
    'site_id', p_site
  ) order by ordinal))
  from unnest(p_items) with ordinality as items (item, ordinal);
$$;

-- proposed for kind 'adjust' of a single target.
create function pg_temp.adjust_to(p_target uuid, p_ago interval)
returns jsonb
language sql
as $$
  select jsonb_build_object('events', jsonb_build_array(
    jsonb_build_object('target_event_id', p_target, 'occurred_at', now() - p_ago)));
$$;

-- Effective (non-void, not superseded) event types of an employee, in time order.
create function pg_temp.effective_types(p_employee uuid)
returns text[]
language sql
as $$
  select array_agg(event.type order by event.occurred_at, event.server_at)
  from public.clock_events as event
  where event.employee_id = p_employee
    and event.type <> 'void'
    and not exists (select 1 from public.clock_events as s where s.supersedes_event_id = event.id);
$$;

-- Everything a failed call must leave untouched, for org A.
create function pg_temp.org_a_state()
returns table (requests bigint, events bigint, audit_rows bigint, clock_head bytea, audit_head bytea)
language sql
as $$
  select
    (select count(*) from public.correction_requests where organization_id = '10000000-0000-4000-8000-000000000eea'),
    (select count(*) from public.clock_events where organization_id = '10000000-0000-4000-8000-000000000eea'),
    (select count(*) from public.audit_log where organization_id = '10000000-0000-4000-8000-000000000eea'),
    (select head_hash from private.hash_chain_heads
     where organization_id = '10000000-0000-4000-8000-000000000eea' and chain = 'clock_events'),
    (select head_hash from private.hash_chain_heads
     where organization_id = '10000000-0000-4000-8000-000000000eea' and chain = 'audit_log');
$$;

select plan(89);

-- Fixtures (rolled back). Org A: owner u1, admin u2, manager u3 (clocks at and
-- manages A1), employee u4 (A1), employee u5 (A2), e8 kiosk-only (A1, no
-- login, A1 and A2), e9 left (A1), e0 anonymised. Org B: owner u6, employee u7.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-000000000ee' || n)::uuid, 'manager-correction-u' || n || '@example.test'
from generate_series(1, 7) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-000000000eea', 'Manager Correction Org A'),
  ('10000000-0000-4000-8000-000000000eeb', 'Manager Correction Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-00000000eea1', '10000000-0000-4000-8000-000000000eea', 'Site A1'),
  ('20000000-0000-4000-8000-00000000eea2', '10000000-0000-4000-8000-000000000eea', 'Site A2'),
  ('20000000-0000-4000-8000-00000000eeb1', '10000000-0000-4000-8000-000000000eeb', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-000000000ee' || n)::uuid,
  case when n >= 6 then '10000000-0000-4000-8000-000000000eeb' else '10000000-0000-4000-8000-000000000eea' end::uuid,
  ('00000000-0000-4000-8000-000000000ee' || n)::uuid,
  (array['owner', 'admin', 'manager', 'employee', 'employee', 'owner', 'employee'])[n],
  'active'
from generate_series(1, 7) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-000000000ee' || n)::uuid,
  case when n >= 6 then '10000000-0000-4000-8000-000000000eeb' else '10000000-0000-4000-8000-000000000eea' end::uuid,
  ('00000000-0000-4000-8000-000000000ee' || n)::uuid,
  'Manager correction employee ' || n
from generate_series(1, 7) as n;

insert into public.employees (id, organization_id, user_id, display_name, active, left_at, anonymised_at) values
  ('40000000-0000-4000-8000-000000000ee8', '10000000-0000-4000-8000-000000000eea', null, 'Kiosk only', true, null, null),
  ('40000000-0000-4000-8000-000000000ee9', '10000000-0000-4000-8000-000000000eea', null, 'Left', false, current_date - 3, null),
  ('40000000-0000-4000-8000-000000000ee0', '10000000-0000-4000-8000-000000000eea', null, 'Anoniem', false, current_date - 3, now());

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee1', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee2', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee3', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea2', '40000000-0000-4000-8000-000000000ee5', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee8', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea2', '40000000-0000-4000-8000-000000000ee8', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee9', null),
  ('10000000-0000-4000-8000-000000000eeb', '20000000-0000-4000-8000-00000000eeb1', '40000000-0000-4000-8000-000000000ee7', null),
  ('10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', null, '30000000-0000-4000-8000-000000000ee3');

-- Past events through the append trigger (a correction source keeps the given
-- occurred_at, so the chains stay valid). e8: clocked in 30 hours ago and
-- never out. e4: a shift 70 days ago and one with a break two days ago. e3,
-- e5, e7, e9: one shift yesterday.
insert into public.clock_events (
  id, organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash
)
select id::uuid, org::uuid, site::uuid, employee::uuid, type, now() - ago::interval, 'correction',
  '00000000-0000-4000-8000-000000000ee1', gen_random_uuid(), '\x00', '\x00'
from (values
  ('e0000000-0000-4000-8000-000000000e81', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee8', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000e45', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', 'clock_in', '70 days'),
  ('e0000000-0000-4000-8000-000000000e46', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', 'clock_out', '69 days 16 hours'),
  ('e0000000-0000-4000-8000-000000000e41', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', 'clock_in', '50 hours'),
  ('e0000000-0000-4000-8000-000000000e42', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', 'break_start', '47 hours'),
  ('e0000000-0000-4000-8000-000000000e43', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', 'break_end', '46 hours'),
  ('e0000000-0000-4000-8000-000000000e44', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee4', 'clock_out', '42 hours'),
  ('e0000000-0000-4000-8000-000000000e31', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee3', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000e32', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee3', 'clock_out', '22 hours'),
  ('e0000000-0000-4000-8000-000000000e51', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea2', '40000000-0000-4000-8000-000000000ee5', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000e52', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea2', '40000000-0000-4000-8000-000000000ee5', 'clock_out', '22 hours'),
  ('e0000000-0000-4000-8000-000000000e91', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee9', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000e92', '10000000-0000-4000-8000-000000000eea', '20000000-0000-4000-8000-00000000eea1', '40000000-0000-4000-8000-000000000ee9', 'clock_out', '22 hours'),
  ('e0000000-0000-4000-8000-000000000e71', '10000000-0000-4000-8000-000000000eeb', '20000000-0000-4000-8000-00000000eeb1', '40000000-0000-4000-8000-000000000ee7', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000e72', '10000000-0000-4000-8000-000000000eeb', '20000000-0000-4000-8000-00000000eeb1', '40000000-0000-4000-8000-000000000ee7', 'clock_out', '22 hours')
) as fixture (id, org, site, employee, type, ago);

-- Created requests, keyed by label.
create temporary table r on commit drop as
select ''::text as label, request.* from public.correction_requests as request with no data;
grant select, insert on r to authenticated;

create temporary table snapshot on commit drop as select * from pg_temp.org_a_state() with no data;

-- Structure ---------------------------------------------------------------------------

select col_not_null('public', 'correction_requests', 'origin', 'origin is always set');
select col_default_is('public', 'correction_requests', 'origin', 'employee', 'origin defaults to employee');
select throws_ok(
  $$insert into public.correction_requests (organization_id, employee_id, requested_by, kind, reason, origin)
    values ('10000000-0000-4000-8000-000000000eea', '40000000-0000-4000-8000-000000000ee4',
      '00000000-0000-4000-8000-000000000ee4', 'add', 'x', 'kiosk')$$,
  '23514', null, 'origin is employee or manager'
);

-- Forgotten clock-out of a kiosk-only employee: manager u3 adds it -----------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');

insert into r select 'forgot', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee8', 'add', '{}',
  pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_out@22 hours'), E'  Vergeten uit te klokken \n');

select results_eq(
  $$select status, origin, employee_id, requested_by, decided_by, decided_at is not null, decision_note, reason, kind
    from r where label = 'forgot'$$,
  $$values ('approved'::text, 'manager'::text, '40000000-0000-4000-8000-000000000ee8'::uuid,
    '00000000-0000-4000-8000-000000000ee3'::uuid, '00000000-0000-4000-8000-000000000ee3'::uuid, true, null::text,
    'Vergeten uit te klokken'::text, 'add'::text)$$,
  'a manager records a forgotten clock-out: approved at once, origin manager, trimmed reason'
);
select results_eq(
  $$select status, origin from public.correction_requests where id = (select id from r where label = 'forgot')$$,
  $$values ('approved'::text, 'manager'::text)$$,
  'the stored row is the returned one'
);
select results_eq(
  $$select type, source, supersedes_event_id, occurred_at, actor_user_id, site_id, employee_id
    from public.clock_events where correction_id = (select id from r where label = 'forgot')$$,
  $$values ('clock_out'::text, 'correction'::text, null::uuid, now() - interval '22 hours',
    '00000000-0000-4000-8000-000000000ee3'::uuid, '20000000-0000-4000-8000-00000000eea1'::uuid,
    '40000000-0000-4000-8000-000000000ee8'::uuid)$$,
  'one clock_out is appended with source correction, the correction id and the manager as actor'
);
select results_eq(
  $$select type, occurred_at, correction_id from public.clock_events where id = 'e0000000-0000-4000-8000-000000000e81'$$,
  $$values ('clock_in'::text, now() - interval '30 hours', null::uuid)$$,
  'the original clock_in is untouched'
);
select is(
  pg_temp.effective_types('40000000-0000-4000-8000-000000000ee8'), array['clock_in', 'clock_out'],
  'the shift is now closed'
);
reset role;
select results_eq(
  $$select log.action, log.actor_user_id, log.metadata ->> 'origin', log.metadata -> 'self_decided'
    from public.audit_log as log
    where log.entity_id = (select id from r where label = 'forgot') order by log.created_at$$,
  $$values
    ('correction_request.created'::text, '00000000-0000-4000-8000-000000000ee3'::uuid, 'manager'::text, null::jsonb),
    ('correction_request.approved', '00000000-0000-4000-8000-000000000ee3', 'manager', 'false')$$,
  'the creation and the approval audit rows are both marked origin manager'
);
select is(
  (select count(*) from public.audit_log as log
   join public.clock_events as event on event.id = log.entity_id
   where log.action = 'clock_event.recorded' and event.correction_id = (select id from r where label = 'forgot')),
  1::bigint, 'the appended event has its own audit row'
);

-- Scope is per employee: a manager of A1 may correct an A1 employee's shift at
-- A2 when that employee is assigned to A2 too (as rpc_decide_correction).
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');
insert into r select 'other_site', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee8', 'add', '{}',
  pg_temp.add_events('20000000-0000-4000-8000-00000000eea2', 'clock_in@10 hours', 'clock_out@9 hours'), 'Vergeten');
select results_eq(
  $$select status, (select array_agg(distinct site_id) from public.clock_events where correction_id = r.id)
    from r where label = 'other_site'$$,
  $$values ('approved'::text, array['20000000-0000-4000-8000-00000000eea2'::uuid])$$,
  'a manager of A1 corrects a shared employee''s shift at A2 (scope is per employee)'
);
reset role;

-- Adjust and remove ---------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee2', '1 minute');
insert into r select 'adjust', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee4', 'adjust', array['e0000000-0000-4000-8000-000000000e44'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e44', '41 hours'), 'Later vertrokken');
select results_eq(
  $$select type, source, supersedes_event_id, occurred_at, actor_user_id
    from public.clock_events where correction_id = (select id from r where label = 'adjust')$$,
  $$values ('clock_out'::text, 'correction'::text, 'e0000000-0000-4000-8000-000000000e44'::uuid,
    now() - interval '41 hours', '00000000-0000-4000-8000-000000000ee2'::uuid)$$,
  'an admin adjusts an event: a superseding event of the same type at the new time'
);
select is(
  (select occurred_at from public.clock_events where id = 'e0000000-0000-4000-8000-000000000e44'),
  now() - interval '42 hours', 'the adjusted original keeps its time'
);

select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');
insert into r select 'remove', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee4', 'remove',
  array['e0000000-0000-4000-8000-000000000e42', 'e0000000-0000-4000-8000-000000000e43']::uuid[], '{}', 'Geen pauze genomen');
select results_eq(
  $$select type, supersedes_event_id, occurred_at from public.clock_events
    where correction_id = (select id from r where label = 'remove') order by occurred_at$$,
  $$values ('void'::text, 'e0000000-0000-4000-8000-000000000e42'::uuid, now() - interval '47 hours'),
    ('void'::text, 'e0000000-0000-4000-8000-000000000e43'::uuid, now() - interval '46 hours')$$,
  'a manager removes events: one void per target at the original time'
);
select is(
  pg_temp.effective_types('40000000-0000-4000-8000-000000000ee4'),
  array['clock_in', 'clock_out', 'clock_in', 'clock_out'],
  'effective events reflect the adjustment and the removal'
);
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'remove'), 'rejected', 'x')$$,
  '55000', 'correction_not_pending', 'a manager correction cannot be decided again'
);

-- Who may correct -------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000ee6', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'adjust',
    array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), 'x')$$,
  '42501', 'not_authorized', 'the owner of org B cannot correct an org A employee'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee7', 'remove',
    array['e0000000-0000-4000-8000-000000000e51', 'e0000000-0000-4000-8000-000000000e52']::uuid[], '{}', 'x')$$,
  '42501', 'not_authorized', 'an own employee cannot be given another org''s events as targets'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee7', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '42501', 'not_authorized', 'an own employee cannot be given events at another org''s site'
);
select throws_ok(
  $$select public.rpc_manager_correct(gen_random_uuid(), 'remove',
    array['e0000000-0000-4000-8000-000000000e71'::uuid], '{}', 'x')$$,
  '42501', 'not_authorized', 'an unknown employee looks like a foreign one'
);
select throws_ok(
  $$select public.rpc_manager_correct(null, 'remove', array['e0000000-0000-4000-8000-000000000e71'::uuid], '{}', 'x')$$,
  '42501', 'not_authorized', 'the employee is required'
);

select pg_temp.login('00000000-0000-4000-8000-000000000ee2', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), 'x')$$,
  '42501', 'not_authorized', 'targets must be events of the named employee'
);

select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'adjust',
    array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), 'x')$$,
  '42501', 'not_authorized', 'a manager cannot correct an employee of an unmanaged site'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee3');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e41'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e41', '51 hours'), 'x')$$,
  '42501', 'not_authorized', 'a manager without aal2 cannot correct'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '13 hours');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e41'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e41', '51 hours'), 'x')$$,
  '42501', 'not_authorized', 'stale MFA cannot correct'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee4', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee3', 'adjust',
    array['e0000000-0000-4000-8000-000000000e32'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e32', '21 hours'), 'x')$$,
  '42501', 'not_authorized', 'an employee cannot correct a colleague, not even with aal2'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e41'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e41', '51 hours'), 'x')$$,
  '42501', 'not_authorized', 'an employee cannot use the manager path for their own record'
);

-- Role hierarchy: managers correct employees only, only an owner an owner -------------------

select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee2', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@14 hours', 'clock_out@13 hours'), 'x')$$,
  '42501', 'not_authorized', 'a manager cannot correct an admin''s record'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee1', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@14 hours', 'clock_out@13 hours'), 'x')$$,
  '42501', 'not_authorized', 'a manager cannot correct the owner''s record'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee2', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee1', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@14 hours', 'clock_out@13 hours'), 'x')$$,
  '42501', 'not_authorized', 'an admin cannot correct the owner''s record'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
insert into r select 'owner_admin', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee2', 'add', '{}',
  pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@14 hours', 'clock_out@13 hours'), 'Vergeten');
select is((select status from r where label = 'owner_admin'), 'approved', 'the owner corrects an admin''s record');

-- Own record: never as manager or admin, the owner may -------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee3', 'adjust',
    array['e0000000-0000-4000-8000-000000000e32'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e32', '21 hours'), 'Later vertrokken')$$,
  '42501', 'self_correction_not_allowed', 'a manager cannot correct their own record'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee2', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee2', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@12 hours', 'clock_out@11 hours'), 'Vergeten')$$,
  '42501', 'self_correction_not_allowed', 'an admin cannot correct their own record'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
insert into r select 'owner_self', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee1', 'add', '{}',
  pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@12 hours', 'clock_out@11 hours'), 'Vergeten');
select is(
  (select status from r where label = 'owner_self'), 'approved',
  'an owner may correct their own record (single-owner businesses)'
);
reset role;
select results_eq(
  $$select r.label, log.metadata -> 'self_decided', log.metadata ->> 'origin'
    from public.audit_log as log join r on r.id = log.entity_id
    where log.action = 'correction_request.approved' order by r.label$$,
  $$values ('adjust'::text, 'false'::jsonb, 'manager'::text), ('forgot', 'false', 'manager'),
    ('other_site', 'false', 'manager'), ('owner_admin', 'false', 'manager'), ('owner_self', 'true', 'manager'),
    ('remove', 'false', 'manager')$$,
  'only the owner''s own correction is audited as self_decided; every approval carries origin'
);

-- Input bounds: the same as an employee request ---------------------------------------------

insert into snapshot select * from pg_temp.org_a_state();
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');

select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'adjust',
    array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), E' \t\n ')$$,
  '22023', 'invalid_reason', 'a blank reason is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'adjust',
    array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), null)$$,
  '22023', 'invalid_reason', 'a missing reason is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'adjust',
    array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), repeat('x', 281))$$,
  '22023', 'invalid_reason', 'a reason above 280 characters is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'edit',
    array['e0000000-0000-4000-8000-000000000e52'::uuid], '{}', 'x')$$,
  '22023', 'invalid_kind', 'unknown kinds are rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea2', 'clock_in@9 hours', 'clock_out@8 hours',
      'clock_in@7 hours', 'clock_out@6 hours', 'clock_in@5 hours', 'clock_out@4 hours', 'clock_in@3 hours',
      'clock_out@2 hours', 'clock_in@1 hour'), 'x')$$,
  '22023', 'invalid_proposal', 'at most eight events per correction'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea2', 'clock_out@10 hours'), 'x')$$,
  'P0001', 'invalid_sequence', 'a correction that breaks the transition rules is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'remove',
    array['e0000000-0000-4000-8000-000000000e51'::uuid], '{}', 'x')$$,
  'P0001', 'invalid_sequence', 'removing a clock_in whose clock_out remains is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea2', 'clock_in@-1 hour'), 'x')$$,
  '22023', 'proposed_time_in_future', 'a time in the future is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea2', 'clock_in@61 days', 'clock_out@60 days 20 hours'), 'x')$$,
  '22023', 'proposed_time_too_old', 'a time older than the org window is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e46'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e46', '59 days'), 'x')$$,
  '22023', 'target_too_old', 'an event older than the org window cannot be corrected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e44'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e44', '40 hours'), 'x')$$,
  '22023', 'target_not_effective', 'an already superseded event cannot be corrected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea2', 'clock_in@22 hours', 'clock_out@21 hours'), 'x')$$,
  '22023', 'proposed_time_conflict', 'a time equal to an existing effective event is rejected'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '42501', 'site_not_assigned', 'added events need a site the employee is assigned to'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee9', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '22023', 'employee_inactive', 'an employee who left cannot be given events'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee9', 'remove',
    array['e0000000-0000-4000-8000-000000000e91', 'e0000000-0000-4000-8000-000000000e92']::uuid[], '{}', 'x')$$,
  '22023', 'employee_inactive', 'an employee who left cannot have events removed'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'remove',
    array['e0000000-0000-4000-8000-000000000e41', 'e0000000-0000-4000-8000-000000000e51']::uuid[], '{}', 'x')$$,
  '42501', 'not_authorized', 'targets of two employees are refused'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee5', 'add', '{}',
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'type', 'clock_in', 'occurred_at', now() - interval '5 hours',
      'site_id', '20000000-0000-4000-8000-00000000eea2', 'work_location', 'home'))), 'x')$$,
  '22023', 'invalid_proposal', 'a work_location in a proposal is refused'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e41'::uuid],
    jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
      'target_event_id', 'e0000000-0000-4000-8000-000000000e41', 'occurred_at', now() - interval '51 hours',
      'type', 'clock_out'))), 'x')$$,
  '22023', 'invalid_proposal', 'an unknown key in an adjustment is refused'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee0', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '22023', 'employee_anonymised', 'an anonymised employee cannot be corrected'
);
reset role;
select results_eq(
  $$select * from pg_temp.org_a_state()$$,
  $$select * from snapshot$$,
  'refused corrections wrote nothing: no request row, no events, no audit rows, same chain heads'
);
select is(
  (select count(*) from public.correction_requests where origin = 'manager' and status <> 'approved'
     and organization_id in ('10000000-0000-4000-8000-000000000eea', '10000000-0000-4000-8000-000000000eeb')),
  0::bigint, 'no manager correction is ever left pending'
);

-- The pending cap is the employee's, not the manager's -----------------------------------------

insert into public.correction_requests (organization_id, employee_id, requested_by, kind, proposed, reason)
select '10000000-0000-4000-8000-000000000eea', '40000000-0000-4000-8000-000000000ee5',
  '00000000-0000-4000-8000-000000000ee5', 'add', '{"events": []}', 'Open aanvraag ' || n
from generate_series(1, 20) as n;

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee5');
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000e52'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), 'x')$$,
  'P0001', 'too_many_pending', 'the employee''s own cap of 20 pending requests still holds'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
insert into r select 'capped', * from public.rpc_manager_correct(
  '40000000-0000-4000-8000-000000000ee5', 'adjust', array['e0000000-0000-4000-8000-000000000e52'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e52', '21 hours'), 'Later vertrokken');
select is(
  (select status from r where label = 'capped'), 'approved',
  'a manager correction is not blocked by the employee''s pending requests'
);

-- The employee path is unchanged and marked employee ---------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000ee4');
insert into r select 'own', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@20 hours', 'clock_out@19 hours'),
  E'\t Vergeten \r\n');
select results_eq(
  $$select status, origin, requested_by, reason from r where label = 'own'$$,
  $$values ('pending'::text, 'employee'::text, '00000000-0000-4000-8000-000000000ee4'::uuid, 'Vergeten'::text)$$,
  'an employee request stays pending, has origin employee and a trimmed reason'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@18 hours', 'clock_out@17 hours'), E'\t\n ')$$,
  '22023', 'invalid_reason', 'an employee reason of only tabs and newlines is blank'
);
select lives_ok(
  $$select public.rpc_request_correction('add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@18 hours', 'clock_out@17 hours'),
    '  ' || repeat('x', 280) || '  ')$$,
  'an employee reason is measured after trimming'
);

-- Reads through RLS: the employee always sees what was changed for them ---------------------

select results_eq(
  $$select kind, origin, status, reason, requested_by from public.correction_requests
    where origin = 'manager' order by created_at$$,
  $$values
    ('adjust'::text, 'manager'::text, 'approved'::text, 'Later vertrokken'::text, '00000000-0000-4000-8000-000000000ee2'::uuid),
    ('remove', 'manager', 'approved', 'Geen pauze genomen', '00000000-0000-4000-8000-000000000ee3')$$,
  'an employee sees the manager corrections of their own record, with reason and author'
);
select is(
  (select count(*) from public.clock_events
   where correction_id in (select id from r where label in ('adjust', 'remove'))),
  3::bigint, 'an employee sees the events those corrections appended'
);
select is(
  (select count(*) from public.correction_requests where employee_id <> '40000000-0000-4000-8000-000000000ee4'),
  0::bigint, 'an employee sees no corrections of colleagues'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee6', '1 minute');
select is(
  (select count(*) from public.correction_requests where organization_id = '10000000-0000-4000-8000-000000000eea'),
  0::bigint, 'the owner of org B sees no org A corrections'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee3', '1 minute');
select is(
  (select count(*) from public.correction_requests where employee_id = '40000000-0000-4000-8000-000000000ee5'),
  0::bigint, 'a manager sees no corrections of an unmanaged site'
);
select throws_ok(
  $$update public.correction_requests set origin = 'employee' where id = (select id from r where label = 'forgot')$$,
  '42501', null, 'authenticated cannot update requests directly'
);

-- Data-subject export -------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
select results_eq(
  $$select request ->> 'origin', request ->> 'reason'
    from jsonb_array_elements(public.rpc_subject_export('40000000-0000-4000-8000-000000000ee8') -> 'correction_requests') as request
    order by request ->> 'created_at'$$,
  $$values ('manager'::text, 'Vergeten uit te klokken'::text), ('manager', 'Vergeten')$$,
  'the subject export says a correction came from a manager'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee4');
select results_eq(
  $$select request ->> 'origin', count(*)
    from jsonb_array_elements(public.rpc_my_data_export() -> 'organizations' -> 0 -> 'correction_requests') as request
    group by 1 order by 1$$,
  $$values ('employee'::text, 2::bigint), ('manager', 2)$$,
  'the employee''s own data export carries the origin of every correction'
);
reset role;

-- origin never changes -------------------------------------------------------------------------

select throws_ok(
  $$update public.correction_requests set origin = 'manager' where id = (select id from r where label = 'own')$$,
  '55000', 'only the decision of a correction request may change', 'origin of a pending request cannot change'
);
select throws_ok(
  $$update public.correction_requests set origin = 'manager', status = 'approved',
      decided_by = '00000000-0000-4000-8000-000000000ee1', decided_at = now()
    where id = (select id from r where label = 'own')$$,
  '55000', 'only the decision of a correction request may change', 'origin cannot change along with the decision'
);
select throws_ok(
  $$update public.correction_requests set origin = 'employee' where id = (select id from r where label = 'forgot')$$,
  '55000', 'correction_requests is immutable after decision', 'origin of a manager correction cannot change'
);

-- An employee request's decision is audited with origin employee ---------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select id from r where label = 'own'), 'approved')),
  'approved', 'the owner approves the employee''s request'
);
reset role;
select is(
  (select metadata ->> 'origin' from public.audit_log
   where entity_id = (select id from r where label = 'own') and action = 'correction_request.approved'),
  'employee', 'the approval audit row of an employee request carries origin employee'
);

-- Rate limit: 60 manager corrections per actor per hour ---------------------------------

-- Old ones do not count.
insert into public.correction_requests (
  organization_id, employee_id, requested_by, kind, proposed, reason, status, decided_by, decided_at, created_at, origin
)
select '10000000-0000-4000-8000-000000000eea', '40000000-0000-4000-8000-000000000ee8',
  '00000000-0000-4000-8000-000000000ee2', 'add', '{"events": []}', 'Eerder', 'approved',
  '00000000-0000-4000-8000-000000000ee2', now() - interval '2 hours', now() - interval '2 hours', 'manager'
from generate_series(1, 100);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee2', '1 minute');
select lives_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee8', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@8 hours', 'clock_out@7 hours'), 'Vergeten')$$,
  'corrections older than an hour do not count towards the limit'
);
reset role;

-- 'adjust' and the one above, plus 58: 60 in the last hour.
insert into public.correction_requests (
  organization_id, employee_id, requested_by, kind, proposed, reason, status, decided_by, decided_at, origin
)
select '10000000-0000-4000-8000-000000000eea', '40000000-0000-4000-8000-000000000ee8',
  '00000000-0000-4000-8000-000000000ee2', 'add', '{"events": []}', 'Recent', 'approved',
  '00000000-0000-4000-8000-000000000ee2', now(), 'manager'
from generate_series(1, 58);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee2', '1 minute');
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee8', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@6 hours', 'clock_out@5 hours'), 'Vergeten')$$,
  '54000', 'correction_rate_limited', 'the 61st manager correction within an hour is refused'
);
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
select lives_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee8', 'add', '{}',
    pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@6 hours', 'clock_out@5 hours'), 'Vergeten')$$,
  'the limit is per actor'
);
reset role;

-- Approval re-checks the employee under the lock --------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee4');
insert into r select 'own2', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-00000000eea1', 'clock_in@4 hours', 'clock_out@3 hours'), 'Vergeten');
reset role;
-- In one session; the real race (an offboarding committing between the checks
-- and the append) is closed by the FOR SHARE row lock and cannot be shown here.
update public.employees set active = false, left_at = current_date
where id = '40000000-0000-4000-8000-000000000ee4';

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'own2'), 'approved')$$,
  '22023', 'employee_inactive', 'a request of an employee who has since left is not approved'
);
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'adjust',
    array['e0000000-0000-4000-8000-000000000e41'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000e41', '51 hours'), 'x')$$,
  '22023', 'employee_inactive', 'an employee who has since left cannot be corrected by a manager'
);
select results_eq(
  $$select status, (select count(*) from public.clock_events where correction_id = request.id)
    from public.rpc_decide_correction((select id from r where label = 'own2'), 'rejected', 'Uit dienst') as request$$,
  $$values ('rejected'::text, 0::bigint)$$,
  'it can still be rejected, without events'
);
reset role;

-- Audit and chains ------------------------------------------------------------------------------

select is(
  (select count(*) from public.clock_events as event
   where event.correction_id in (select id from r)
     and (select count(*) from public.audit_log as log
          where log.entity = 'clock_event' and log.entity_id = event.id) <> 1),
  0::bigint, 'every appended correction event has exactly one audit row'
);
select is(
  (select count(*) from public.audit_log
   where organization_id = '10000000-0000-4000-8000-000000000eea'
     and metadata::text ~* 'vergeten|vertrokken|pauze'),
  0::bigint, 'audit metadata never carries the reason'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-000000000eea'), null, 'the clock chain verifies after manager corrections');
select is(private.verify_audit_chain('10000000-0000-4000-8000-000000000eea'), null, 'the audit chain verifies after manager corrections');

-- Grants -------------------------------------------------------------------------------------------

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'remove',
    array['e0000000-0000-4000-8000-000000000e41'::uuid], '{}', 'x')$$,
  '42501', null, 'anon cannot correct'
);
reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select public.rpc_manager_correct('40000000-0000-4000-8000-000000000ee4', 'remove',
    array['e0000000-0000-4000-8000-000000000e41'::uuid], '{}', 'x')$$,
  '42501', null, 'service_role cannot correct'
);
reset role;
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000ee1', '1 minute');
select throws_ok(
  $$select private.manager_correct('40000000-0000-4000-8000-000000000ee4', 'remove',
    array['e0000000-0000-4000-8000-000000000e41'::uuid], '{}', 'x')$$,
  '42501', null, 'the private implementation is not executable by authenticated'
);
select throws_ok(
  $$select private.correction_parse('remove', array['e0000000-0000-4000-8000-000000000e41'::uuid], '{}', 'x')$$,
  '42501', null, 'the shared parser is not executable by authenticated'
);
select throws_ok(
  $$select private.correction_check('10000000-0000-4000-8000-000000000eea', '40000000-0000-4000-8000-000000000ee4',
    'remove', array['e0000000-0000-4000-8000-000000000e41'::uuid], '{}', '[]', now())$$,
  '42501', null, 'the shared checks are not executable by authenticated'
);
reset role;

select * from finish();
rollback;
