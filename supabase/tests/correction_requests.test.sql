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

-- Effective (non-void, not superseded) event ids of an employee, in time order.
create function pg_temp.effective(p_employee uuid)
returns uuid[]
language sql
as $$
  select array_agg(event.id order by event.occurred_at, event.server_at)
  from public.clock_events as event
  where event.employee_id = p_employee
    and event.type <> 'void'
    and not exists (select 1 from public.clock_events as s where s.supersedes_event_id = event.id);
$$;

select plan(87);

-- Fixtures (rolled back). Org A: owner u1, admin u2, manager u3 (clocks at and
-- manages A1), employee u4 (A1), employee u5 (A2). Org B: owner u6, employee u7.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000050' || n)::uuid, 'correction-u' || n || '@example.test'
from generate_series(1, 7) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000050a', 'Correction Org A'),
  ('10000000-0000-4000-8000-00000000050b', 'Correction Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000005a1', '10000000-0000-4000-8000-00000000050a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000005a2', '10000000-0000-4000-8000-00000000050a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000005a3', '10000000-0000-4000-8000-00000000050a', 'Site A3 (closed)'),
  ('20000000-0000-4000-8000-0000000005b1', '10000000-0000-4000-8000-00000000050b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000050' || n)::uuid,
  case when n >= 6 then '10000000-0000-4000-8000-00000000050b' else '10000000-0000-4000-8000-00000000050a' end::uuid,
  ('00000000-0000-4000-8000-00000000050' || n)::uuid,
  (array['owner', 'admin', 'manager', 'employee', 'employee', 'owner', 'employee'])[n],
  'active'
from generate_series(1, 7) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000050' || n)::uuid,
  case when n >= 6 then '10000000-0000-4000-8000-00000000050b' else '10000000-0000-4000-8000-00000000050a' end::uuid,
  ('00000000-0000-4000-8000-00000000050' || n)::uuid,
  'Correction employee ' || n
from generate_series(1, 7) as n;

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000501', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000502', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000503', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a2', '40000000-0000-4000-8000-000000000505', null),
  ('10000000-0000-4000-8000-00000000050b', '20000000-0000-4000-8000-0000000005b1', '40000000-0000-4000-8000-000000000506', null),
  ('10000000-0000-4000-8000-00000000050b', '20000000-0000-4000-8000-0000000005b1', '40000000-0000-4000-8000-000000000507', null),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', null, '30000000-0000-4000-8000-000000000503'),
  ('10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a3', '40000000-0000-4000-8000-000000000504', null);
update public.sites set active = false where id = '20000000-0000-4000-8000-0000000005a3';

-- Past events through the append trigger (a correction source keeps the
-- given occurred_at, so the chains stay valid). e4: a shift 70 days ago and a
-- shift with a break two days ago. e3, e5, e7: one shift yesterday.
insert into public.clock_events (
  id, organization_id, site_id, employee_id, type, occurred_at, source, actor_user_id, idempotency_key, prev_hash, hash
)
select id::uuid, org::uuid, site::uuid, employee::uuid, type, now() - ago::interval, 'correction',
  '00000000-0000-4000-8000-000000000501', gen_random_uuid(), '\x00', '\x00'
from (values
  ('e0000000-0000-4000-8000-000000000545', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', 'clock_in', '70 days'),
  ('e0000000-0000-4000-8000-000000000546', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', 'clock_out', '69 days 16 hours'),
  ('e0000000-0000-4000-8000-000000000541', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', 'clock_in', '50 hours'),
  ('e0000000-0000-4000-8000-000000000542', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', 'break_start', '47 hours'),
  ('e0000000-0000-4000-8000-000000000543', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', 'break_end', '46 hours'),
  ('e0000000-0000-4000-8000-000000000544', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000504', 'clock_out', '42 hours'),
  ('e0000000-0000-4000-8000-000000000531', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000503', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000532', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a1', '40000000-0000-4000-8000-000000000503', 'clock_out', '22 hours'),
  ('e0000000-0000-4000-8000-000000000551', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a2', '40000000-0000-4000-8000-000000000505', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000552', '10000000-0000-4000-8000-00000000050a', '20000000-0000-4000-8000-0000000005a2', '40000000-0000-4000-8000-000000000505', 'clock_out', '22 hours'),
  ('e0000000-0000-4000-8000-000000000571', '10000000-0000-4000-8000-00000000050b', '20000000-0000-4000-8000-0000000005b1', '40000000-0000-4000-8000-000000000507', 'clock_in', '30 hours'),
  ('e0000000-0000-4000-8000-000000000572', '10000000-0000-4000-8000-00000000050b', '20000000-0000-4000-8000-0000000005b1', '40000000-0000-4000-8000-000000000507', 'clock_out', '22 hours')
) as fixture (id, org, site, employee, type, ago);

-- Created requests, keyed by label.
create temporary table r on commit drop as
select ''::text as label, request.* from public.correction_requests as request with no data;
grant select, insert on r to authenticated;
grant select on r to service_role;

-- Structure ---------------------------------------------------------------------------

select columns_are(
  'public', 'correction_requests',
  array[
    'id', 'organization_id', 'employee_id', 'requested_by', 'kind', 'target_event_ids', 'proposed', 'reason',
    'status', 'created_at', 'decided_by', 'decided_at', 'decision_note'
  ],
  'correction_requests has the contract columns'
);
select fk_ok(
  'public', 'clock_events', array['organization_id', 'correction_id'],
  'public', 'correction_requests', array['organization_id', 'id'],
  'clock_events.correction_id references a request of the same org'
);

-- Requests by employee u4 (aal1) -------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000504');

insert into r select 'adjust1', * from public.rpc_request_correction(
  'adjust', array['e0000000-0000-4000-8000-000000000541'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000541', '51 hours'), 'Vergeten in te klokken');

select results_eq(
  $$select status, employee_id, requested_by, kind, decided_by from r where label = 'adjust1'$$,
  $$values ('pending'::text, '40000000-0000-4000-8000-000000000504'::uuid, '00000000-0000-4000-8000-000000000504'::uuid, 'adjust'::text, null::uuid)$$,
  'an employee requests a correction of their own effective event'
);
select is(
  (select (proposed #>> '{events,0,occurred_at}')::timestamptz from r where label = 'adjust1'),
  now() - interval '51 hours', 'the proposed time is stored'
);

select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000552'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000552', '21 hours'), 'x')$$,
  '42501', 'not_authorized', 'an employee cannot correct another employee''s events'
);
select throws_ok(
  $$select public.rpc_request_correction('remove', array['e0000000-0000-4000-8000-000000000551'::uuid], '{}', 'x')$$,
  '42501', 'not_authorized', 'an employee cannot remove another employee''s events'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000572'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000572', '21 hours'), 'x')$$,
  '42501', 'not_authorized', 'an employee cannot target another org''s events'
);
select throws_ok(
  $$select public.rpc_request_correction('remove', array[gen_random_uuid()], '{}', 'x')$$,
  '42501', 'not_authorized', 'unknown targets look like foreign ones'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a2', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '42501', 'site_not_assigned', 'added events need a site the employee is assigned to'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005b1', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '42501', 'not_authorized', 'added events cannot be placed in another org'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@-1 hour', 'clock_out@-2 hours'), 'x')$$,
  '22023', 'proposed_time_in_future', 'proposed times in the future are rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '-5 minutes'), 'x')$$,
  '22023', 'proposed_time_in_future', 'an adjustment into the future is rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@61 days', 'clock_out@60 days 20 hours'), 'x')$$,
  '22023', 'proposed_time_too_old', 'proposed times older than 60 days are rejected by default'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000546'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000546', '59 days'), 'x')$$,
  '22023', 'target_too_old', 'events older than the window cannot be corrected'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '41 hours'), repeat('x', 281))$$,
  '22023', 'invalid_reason', 'reasons above 280 characters are rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '41 hours'), '   ')$$,
  '22023', 'invalid_reason', 'a blank reason is rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('edit', array['e0000000-0000-4000-8000-000000000544'::uuid], '{}', 'x')$$,
  '22023', 'invalid_kind', 'unknown kinds are rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('add', array['e0000000-0000-4000-8000-000000000544'::uuid],
    pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '22023', 'invalid_targets', 'add takes no targets'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', '{}', '{"events": []}', 'x')$$,
  '22023', 'invalid_targets', 'adjust needs targets'
);
select throws_ok(
  $$select public.rpc_request_correction('remove', array['e0000000-0000-4000-8000-000000000544'::uuid], '{"events": [], "note": "x"}', 'x')$$,
  '22023', 'invalid_proposal', 'unknown proposal keys are rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
    '{"events": [{"target_event_id": "e0000000-0000-4000-8000-000000000544", "occurred_at": "2026-09-01 10:00"}]}', 'x')$$,
  '22023', 'invalid_proposed_time', 'proposed times need an explicit offset'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_out@10 hours'), 'x')$$,
  'P0001', 'invalid_sequence', 'a proposal that breaks the transition rules is rejected up front'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@42 hours', 'clock_out@41 hours'), 'x')$$,
  '22023', 'proposed_time_conflict', 'a proposed instant equal to an existing effective event is rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '46 hours'), 'x')$$,
  '22023', 'proposed_time_conflict', 'an adjustment onto another event''s instant is rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@5 hours', 'clock_out@5 hours'), 'x')$$,
  '22023', 'proposed_times_not_increasing', 'two proposed events at the same instant are rejected'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@4 hours', 'clock_out@5 hours'), 'x')$$,
  '22023', 'proposed_times_not_increasing', 'proposed events must be in time order'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}',
    '{"events": [{"type": "clock_in", "occurred_at": "2026-09-01T10:00:00+99:00", "site_id": "20000000-0000-4000-8000-0000000005a1"}]}', 'x')$$,
  '22023', 'invalid_proposed_time', 'an out-of-range UTC offset is an invalid proposed time'
);
select throws_ok(
  $$select public.rpc_request_correction('add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a3', 'clock_in@5 hours', 'clock_out@4 hours'), 'x')$$,
  '22023', 'site_inactive', 'added events need an active site'
);
select throws_ok(
  $$insert into public.correction_requests (organization_id, employee_id, requested_by, kind, reason)
    values ('10000000-0000-4000-8000-00000000050a', '40000000-0000-4000-8000-000000000504', '00000000-0000-4000-8000-000000000504', 'add', 'x')$$,
  '42501', null, 'authenticated cannot insert requests directly'
);
reset role;

-- The window is an org setting.
update public.organizations
set settings = settings || '{"correction_max_age_days": 90}'
where id = '10000000-0000-4000-8000-00000000050a';
select throws_ok(
  $$update public.organizations set settings = settings || '{"correction_max_age_days": 0}' where id = '10000000-0000-4000-8000-00000000050a'$$,
  '23514', null, 'a zero-day window is rejected'
);
select throws_ok(
  $$update public.organizations set settings = settings || '{"correction_max_age_days": "60"}' where id = '10000000-0000-4000-8000-00000000050a'$$,
  '23514', null, 'the window must be a number'
);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000504');
insert into r select 'old_add', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@65 days', 'clock_out@64 days 20 hours'), 'Vergeten');
select is((select status from r where label = 'old_add'), 'pending', 'a 90-day org window accepts a 65-day-old proposal');

-- Approval appends --------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000503', '1 minute');
select results_eq(
  $$select status, decided_by, decided_at is not null, decision_note
    from public.rpc_decide_correction((select id from r where label = 'adjust1'), 'approved')$$,
  $$values ('approved'::text, '00000000-0000-4000-8000-000000000503'::uuid, true, null::text)$$,
  'a manager with fresh MFA approves a request of a managed employee'
);
select results_eq(
  $$select type, source, supersedes_event_id, occurred_at, actor_user_id, site_id
    from public.clock_events where correction_id = (select id from r where label = 'adjust1')$$,
  $$values ('clock_in'::text, 'correction'::text, 'e0000000-0000-4000-8000-000000000541'::uuid,
    now() - interval '51 hours', '00000000-0000-4000-8000-000000000503'::uuid, '20000000-0000-4000-8000-0000000005a1'::uuid)$$,
  'approval appends a superseding correction event at the proposed time'
);
select is(
  (select count(*) from public.clock_events where id = 'e0000000-0000-4000-8000-000000000541'),
  1::bigint, 'the original event remains'
);
select is(
  pg_temp.effective('40000000-0000-4000-8000-000000000504'),
  array[
    'e0000000-0000-4000-8000-000000000545', 'e0000000-0000-4000-8000-000000000546',
    (select id from public.clock_events where correction_id = (select id from r where label = 'adjust1')),
    'e0000000-0000-4000-8000-000000000542', 'e0000000-0000-4000-8000-000000000543', 'e0000000-0000-4000-8000-000000000544'
  ]::uuid[],
  'effective events reflect the adjustment'
);
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'adjust1'), 'approved')$$,
  '55000', 'correction_not_pending', 'a second approval is rejected'
);
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'adjust1'), 'rejected', 'x')$$,
  '55000', 'correction_not_pending', 'a decided request cannot be rejected afterwards'
);
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'old_add'), 'maybe')$$,
  '22023', 'invalid_decision', 'only approved or rejected are decisions'
);
reset role;

select throws_ok(
  $$update public.correction_requests set status = 'rejected' where id = (select id from r where label = 'adjust1')$$,
  '55000', 'correction_requests is immutable after decision', 'a decided request is immutable, even for the table owner'
);
select throws_ok(
  $$update public.correction_requests set reason = 'changed' where id = (select id from r where label = 'old_add')$$,
  '55000', 'only the decision of a correction request may change', 'a pending request keeps its content'
);
select throws_ok(
  $$delete from public.correction_requests where id = (select id from r where label = 'old_add')$$,
  '55000', 'correction_requests is append-only', 'requests are never deleted'
);

-- Who may decide -------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000503', '13 hours');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'old_add'), 'approved')$$,
  '42501', 'not_authorized', 'stale MFA cannot decide'
);
select pg_temp.login('00000000-0000-4000-8000-000000000503');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'old_add'), 'approved')$$,
  '42501', 'not_authorized', 'a manager without aal2 cannot decide'
);
select pg_temp.login('00000000-0000-4000-8000-000000000504', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'old_add'), 'approved')$$,
  '42501', 'not_authorized', 'an employee cannot decide, not even with aal2'
);
select pg_temp.login('00000000-0000-4000-8000-000000000506', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'old_add'), 'approved')$$,
  '42501', 'not_authorized', 'the owner of org B cannot decide org A requests'
);

select pg_temp.login('00000000-0000-4000-8000-000000000505');
insert into r select 'e5_adjust', * from public.rpc_request_correction(
  'adjust', array['e0000000-0000-4000-8000-000000000552'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000552', '21 hours'), 'Later vertrokken');
select pg_temp.login('00000000-0000-4000-8000-000000000503', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'e5_adjust'), 'approved')$$,
  '42501', 'not_authorized', 'a manager cannot decide for an unmanaged site'
);

-- Own request of a manager.
select pg_temp.login('00000000-0000-4000-8000-000000000503');
select throws_ok(
  $$select public.rpc_request_correction('remove', array['e0000000-0000-4000-8000-000000000531'::uuid], '{}', 'x')$$,
  'P0001', 'invalid_sequence', 'removing a clock_in whose clock_out remains is rejected'
);
insert into r select 'self', * from public.rpc_request_correction(
  'adjust', array['e0000000-0000-4000-8000-000000000532'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000532', '21 hours'), 'Later vertrokken');
select pg_temp.login('00000000-0000-4000-8000-000000000503', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'self'), 'approved')$$,
  '42501', 'self_decision_not_allowed', 'a manager cannot decide their own request'
);
select pg_temp.login('00000000-0000-4000-8000-000000000502', '1 minute');
select results_eq(
  $$select status, decided_by, decided_at is not null, decision_note
    from public.rpc_decide_correction((select id from r where label = 'self'), 'rejected', 'Klopt niet met planning')$$,
  $$values ('rejected'::text, '00000000-0000-4000-8000-000000000502'::uuid, true, 'Klopt niet met planning'::text)$$,
  'an admin decides the manager''s request; rejection stores decider, time and note'
);
select is(
  (select count(*) from public.clock_events where correction_id = (select id from r where label = 'self')),
  0::bigint, 'a rejection appends no events'
);

-- Own requests of an admin and of the owner.
select pg_temp.login('00000000-0000-4000-8000-000000000502');
insert into r select 'own_admin', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@12 hours', 'clock_out@11 hours'), 'Vergeten');
select pg_temp.login('00000000-0000-4000-8000-000000000502', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'own_admin'), 'approved')$$,
  '42501', 'self_decision_not_allowed', 'an admin cannot decide their own request'
);
select pg_temp.login('00000000-0000-4000-8000-000000000501');
insert into r select 'own_owner', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@12 hours', 'clock_out@11 hours'), 'Vergeten');
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select id from r where label = 'own_owner'), 'approved')),
  'approved', 'an owner may decide their own request (single-owner businesses)'
);

-- An approval that would break the sequence rolls back fully ---------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000504');
insert into r select 'addA', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@30 hours', 'clock_out@26 hours'), 'Vergeten');
insert into r select 'addB', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@29 hours', 'clock_out@27 hours'), 'Vergeten');
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select id from r where label = 'addA'), 'approved')),
  'approved', 'the owner approves the first of two overlapping additions'
);
reset role;

create temporary table snapshot on commit drop as
select
  (select count(*) from public.clock_events where organization_id = '10000000-0000-4000-8000-00000000050a') as events,
  (select count(*) from public.audit_log where organization_id = '10000000-0000-4000-8000-00000000050a') as audit_rows,
  (select head_hash from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000050a' and chain = 'clock_events') as clock_head,
  (select head_hash from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000050a' and chain = 'audit_log') as audit_head;

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'addB'), 'approved')$$,
  'P0001', 'invalid_sequence', 'approving the overlapping addition is rejected'
);
reset role;
select results_eq(
  $$select
    (select count(*) from public.clock_events where organization_id = '10000000-0000-4000-8000-00000000050a'),
    (select count(*) from public.audit_log where organization_id = '10000000-0000-4000-8000-00000000050a'),
    (select head_hash from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000050a' and chain = 'clock_events'),
    (select head_hash from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000050a' and chain = 'audit_log'),
    (select status from public.correction_requests where id = (select id from r where label = 'addB'))$$,
  $$select events, audit_rows, clock_head, audit_head, 'pending'::text from snapshot$$,
  'the failed approval changed nothing: no events, no audit rows, same chain heads, still pending'
);

-- Targets must still be effective at approval ----------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000504');
insert into r select 'adjC', * from public.rpc_request_correction(
  'adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '41 hours'), 'Later vertrokken');
insert into r select 'adjD', * from public.rpc_request_correction(
  'adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
  pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '40 hours'), 'Nog later vertrokken');
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select id from r where label = 'adjC'), 'approved')),
  'approved', 'the first adjustment of an event is approved'
);
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'adjD'), 'approved')$$,
  '55000', 'target_not_effective', 'a second adjustment of the same event is rejected at approval'
);
select pg_temp.login('00000000-0000-4000-8000-000000000504');
select throws_ok(
  $$select public.rpc_request_correction('adjust', array['e0000000-0000-4000-8000-000000000544'::uuid],
    pg_temp.adjust_to('e0000000-0000-4000-8000-000000000544', '39 hours'), 'x')$$,
  '22023', 'target_not_effective', 'a superseded event cannot be targeted'
);

-- Removal appends voids --------------------------------------------------------------------------

insert into r select 'rm', * from public.rpc_request_correction(
  'remove', array['e0000000-0000-4000-8000-000000000542', 'e0000000-0000-4000-8000-000000000543']::uuid[], '{}', 'Geen pauze genomen');
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select id from r where label = 'rm'), 'approved', 'Ok')),
  'approved', 'the owner approves a removal'
);
select results_eq(
  $$select type, supersedes_event_id, occurred_at from public.clock_events
    where correction_id = (select id from r where label = 'rm') order by occurred_at$$,
  $$values ('void'::text, 'e0000000-0000-4000-8000-000000000542'::uuid, now() - interval '47 hours'),
    ('void'::text, 'e0000000-0000-4000-8000-000000000543'::uuid, now() - interval '46 hours')$$,
  'removal appends one void per target at the original time'
);
select is(
  pg_temp.effective('40000000-0000-4000-8000-000000000504'),
  array[
    'e0000000-0000-4000-8000-000000000545', 'e0000000-0000-4000-8000-000000000546',
    (select id from public.clock_events where correction_id = (select id from r where label = 'adjust1')),
    (select id from public.clock_events where correction_id = (select id from r where label = 'adjC'))
  ]::uuid[]
  || array(select id from public.clock_events where correction_id = (select id from r where label = 'addA') order by occurred_at),
  'effective events: removed break gone, adjusted and added events in place'
);
select pg_temp.login('00000000-0000-4000-8000-000000000504');
select throws_ok(
  $$select public.rpc_request_correction('remove',
    array[(select id from public.clock_events where correction_id = (select id from r where label = 'rm') order by occurred_at limit 1)],
    '{}', 'x')$$,
  '22023', 'target_not_effective', 'a void event cannot be targeted'
);

-- Withdraw ------------------------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000504');
insert into r select 'wd', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@20 hours', 'clock_out@19 hours'), 'Vergeten');
select pg_temp.login('00000000-0000-4000-8000-000000000505');
select throws_ok(
  $$select public.rpc_withdraw_correction((select id from r where label = 'wd'))$$,
  '42501', 'not_authorized', 'another employee cannot withdraw the request'
);
select pg_temp.login('00000000-0000-4000-8000-000000000504');
select results_eq(
  $$select status, decided_by from public.rpc_withdraw_correction((select id from r where label = 'wd'))$$,
  $$values ('withdrawn'::text, '00000000-0000-4000-8000-000000000504'::uuid)$$,
  'the requester withdraws a pending request'
);
select throws_ok(
  $$select public.rpc_withdraw_correction((select id from r where label = 'wd'))$$,
  '55000', 'correction_not_pending', 'a withdrawn request cannot be withdrawn again'
);
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'wd'), 'approved')$$,
  '55000', 'correction_not_pending', 'a withdrawn request cannot be approved'
);

-- Equal instants appearing between request and approval.
select pg_temp.login('00000000-0000-4000-8000-000000000504');
insert into r select 'P', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@38 hours', 'clock_out@37 hours'), 'Vergeten');
insert into r select 'Q', * from public.rpc_request_correction(
  'add', '{}', pg_temp.add_events('20000000-0000-4000-8000-0000000005a1', 'clock_in@37 hours', 'clock_out@36 hours'), 'Vergeten');
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select id from r where label = 'P'), 'approved')),
  'approved', 'the first of two requests sharing an instant is approved'
);
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'Q'), 'approved')$$,
  '22023', 'proposed_time_conflict', 'approval re-checks equal instants against events appended since the request'
);

-- Reads through RLS ------------------------------------------------------------------------------

select is(
  (select count(*) from public.correction_requests where organization_id = '10000000-0000-4000-8000-00000000050a'),
  (select count(*) from r), 'the owner with fresh MFA sees every request of the org'
);
select pg_temp.login('00000000-0000-4000-8000-000000000504');
select is(
  (select count(*) from public.correction_requests where employee_id <> '40000000-0000-4000-8000-000000000504'),
  0::bigint, 'an employee sees only own requests'
);
select is(
  (select count(*) from public.correction_requests),
  (select count(*) from r where employee_id = '40000000-0000-4000-8000-000000000504'),
  'an employee sees all own requests'
);
select pg_temp.login('00000000-0000-4000-8000-000000000503', '1 minute');
select is(
  (select count(*) from public.correction_requests where employee_id = '40000000-0000-4000-8000-000000000505'),
  0::bigint, 'a manager does not see requests of an unmanaged site'
);
select is(
  (select count(*) from public.correction_requests where employee_id = '40000000-0000-4000-8000-000000000504'),
  (select count(*) from r where employee_id = '40000000-0000-4000-8000-000000000504'),
  'a manager sees requests of a managed employee'
);
select pg_temp.login('00000000-0000-4000-8000-000000000503');
select is((select count(*) from public.correction_requests), 1::bigint, 'a manager without aal2 sees only own requests');
select pg_temp.login('00000000-0000-4000-8000-000000000506', '1 minute');
select is(
  (select count(*) from public.correction_requests where organization_id = '10000000-0000-4000-8000-00000000050a'),
  0::bigint, 'the owner of org B sees no org A requests'
);
reset role;

-- Audit and chains ------------------------------------------------------------------------------

select is(
  (select count(*) from r
   where (select count(*) from public.audit_log as log
          where log.entity_id = r.id and log.action = 'correction_request.created') <> 1),
  0::bigint, 'every request wrote exactly one creation audit row'
);
select results_eq(
  $$select r.label, log.action, log.actor_user_id from public.audit_log as log join r on r.id = log.entity_id
    where log.action <> 'correction_request.created' order by log.created_at$$,
  $$values
    ('adjust1'::text, 'correction_request.approved'::text, '00000000-0000-4000-8000-000000000503'::uuid),
    ('self', 'correction_request.rejected', '00000000-0000-4000-8000-000000000502'),
    ('own_owner', 'correction_request.approved', '00000000-0000-4000-8000-000000000501'),
    ('addA', 'correction_request.approved', '00000000-0000-4000-8000-000000000501'),
    ('adjC', 'correction_request.approved', '00000000-0000-4000-8000-000000000501'),
    ('rm', 'correction_request.approved', '00000000-0000-4000-8000-000000000501'),
    ('wd', 'correction_request.withdrawn', '00000000-0000-4000-8000-000000000504'),
    ('P', 'correction_request.approved', '00000000-0000-4000-8000-000000000501')$$,
  'every decision and withdrawal wrote one audit row; failed approvals wrote none'
);
select results_eq(
  $$select r.label, log.metadata -> 'self_decided' from public.audit_log as log join r on r.id = log.entity_id
    where log.action = 'correction_request.approved' and r.label in ('adjust1', 'own_owner')
    order by r.label$$,
  $$values ('adjust1'::text, 'false'::jsonb), ('own_owner', 'true')$$,
  'an owner deciding their own request is audited as self_decided'
);
select is(
  (select count(*) from public.clock_events as event
   where event.correction_id is not null
     and (select count(*) from public.audit_log as log
          where log.entity = 'clock_event' and log.entity_id = event.id) <> 1),
  0::bigint, 'every appended correction event has exactly one audit row'
);
select is(
  (select count(*) from public.audit_log where metadata::text ~* 'vergeten|klopt|pauze'),
  0::bigint, 'audit metadata never carries reasons or notes'
);
select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000050a'), null, 'the clock chain verifies after corrections');
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000050a'), null, 'the audit chain verifies after corrections');

-- Grants -------------------------------------------------------------------------------------------

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select public.rpc_request_correction('remove', array['e0000000-0000-4000-8000-000000000544'::uuid], '{}', 'x')$$,
  '42501', null, 'anon cannot request corrections'
);
reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select public.rpc_decide_correction((select id from r where label = 'old_add'), 'approved')$$,
  '42501', null, 'service_role cannot decide corrections'
);
select throws_ok(
  $$select public.rpc_request_correction('remove', array['e0000000-0000-4000-8000-000000000544'::uuid], '{}', 'x')$$,
  '42501', null, 'service_role cannot request corrections'
);
reset role;
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000501', '1 minute');
select throws_ok(
  $$select private.decide_correction((select id from r where label = 'old_add'), 'approved')$$,
  '42501', null, 'the private implementation is not executable by authenticated'
);
reset role;

select * from finish();
rollback;
