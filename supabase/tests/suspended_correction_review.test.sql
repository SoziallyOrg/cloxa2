begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

-- Synthetic transaction-scoped fixture identities, never real Auth credentials.
create function pg_temp.sid(prefix integer, number integer)
returns uuid language sql immutable as $$
  select (prefix::text || '00000-0000-4000-b000-' || lpad(number::text, 12, '0'))::uuid
$$;
create function pg_temp.slogin(number integer)
returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.sid(951, number), 'session_id', pg_temp.sid(952, number),
    'role', 'authenticated', 'exp', extract(epoch from now() + interval '1 hour')::bigint
  )::text, true)::text::void
$$;
create function pg_temp.time_decide(operation_number integer, claim_number integer,
  decision text default 'approve', note text default 'Fictieve managernotitie')
returns jsonb language sql as $$
  select to_jsonb(result) from public.decide_correction_request(
    pg_temp.sid(959, operation_number), pg_temp.sid(957, claim_number), decision, note
  ) result
$$;
create function pg_temp.break_decide(operation_number integer, claim_number integer,
  decision text default 'approve', note text default 'Fictieve managernotitie')
returns jsonb language sql as $$
  select public.decide_break_correction(
    pg_temp.sid(960, operation_number), pg_temp.sid(958, claim_number), decision, note, true
  )
$$;

insert into auth.users (id, email, email_confirmed_at, encrypted_password)
select pg_temp.sid(951, n), 'suspended.review.' || n || '@example.test',
  now() - interval '1 day', 'synthetic-not-a-password' from generate_series(1, 10) n;
insert into auth.sessions (id, user_id, created_at, updated_at)
select pg_temp.sid(952, n), pg_temp.sid(951, n), now(), now() from generate_series(1, 10) n;
insert into public.organizations (id, name, lifecycle_status) values
  (pg_temp.sid(953, 1), 'Fictief historisch team', 'research_pilot'),
  (pg_temp.sid(953, 2), 'Fictief ander team', 'paid_beta');
insert into public.worksites (id, organization_id, name)
select pg_temp.sid(954, n), pg_temp.sid(953, n), 'Fictieve werkplek ' || n from generate_series(1, 2) n;
insert into public.memberships (id, organization_id, user_id, role, status, employee_code)
select pg_temp.sid(955, n), pg_temp.sid(953, case when n in (7, 8) then 2 else 1 end),
  pg_temp.sid(951, n), case when n in (1, 8) then 'manager' else 'employee' end,
  'active', 'SUSP-REVIEW-' || n from generate_series(1, 10) n;
insert into public.profiles (user_id, display_name)
select pg_temp.sid(951, n), 'Fictieve naam ' || n from generate_series(1, 10) n;

-- Six nonoverlapping closed days per employee: approval, rejection and pending claims.
-- Owner-created pending snapshots match claims captured before suspension.
insert into public.time_entries (id, organization_id, membership_id, worksite_id, started_at, ended_at)
select pg_temp.sid(956, n * 10 + slot),
  pg_temp.sid(953, case when n = 7 then 2 else 1 end), pg_temp.sid(955, n),
  pg_temp.sid(954, case when n = 7 then 2 else 1 end),
  '2010-01-01 08:00Z'::timestamptz + (n * 10 + slot) * interval '1 day',
  '2010-01-01 16:00Z'::timestamptz + (n * 10 + slot) * interval '1 day'
from unnest(array[2, 3, 4, 5, 6, 7, 9, 10]) n cross join generate_series(1, 6) slot;
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, target_time_entry_id,
  request_kind, proposed_started_at, proposed_ended_at, original_started_at,
  original_ended_at, original_time_entry_version, employee_reason, submission_request_id
)
select pg_temp.sid(957, n * 10 + slot), e.organization_id, e.membership_id, e.worksite_id,
  e.id, 'adjustment', e.started_at + interval '15 minutes',
  e.ended_at + interval '15 minutes', e.started_at, e.ended_at, e.version,
  'Fictieve persoonlijke reden', pg_temp.sid(961, n * 10 + slot)
from unnest(array[2, 3, 4, 5, 6, 7, 9, 10]) n cross join unnest(array[1, 3, 5]) slot
join public.time_entries e on e.id = pg_temp.sid(956, n * 10 + slot);
insert into public.break_correction_requests (
  id, organization_id, employee_membership_id, worksite_id, time_entry_id,
  logical_break_id, request_kind, parent_version, parent_started_at, parent_ended_at,
  proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
)
select pg_temp.sid(958, n * 10 + slot), e.organization_id, e.membership_id, e.worksite_id,
  e.id, pg_temp.sid(962, n * 10 + slot), 'missed_break', e.version,
  e.started_at, e.ended_at, e.started_at + interval '4 hours',
  e.started_at + interval '4 hours 30 minutes',
  'Fictieve persoonlijke pauzereden', pg_temp.sid(963, n * 10 + slot)
from unnest(array[2, 3, 4, 5, 6, 7, 9, 10]) n cross join unnest(array[2, 4, 6]) slot
join public.time_entries e on e.id = pg_temp.sid(956, n * 10 + slot);

set local role authenticated;
select pg_temp.slogin(1);
select is(public.change_employee_membership_status(
  pg_temp.sid(964, n), pg_temp.sid(955, n), 'suspend', true
)->>'result_code', 'suspended', 'pending requests permit suspension of employee ' || n)
from unnest(array[2, 3, 10]) n;
reset role;
update public.memberships set status = 'invited' where id = pg_temp.sid(955, 4);
update public.memberships set status = 'inactive' where id = pg_temp.sid(955, 5);
insert into public.memberships (id, organization_id, user_id, role, status)
select pg_temp.sid(955, 100 + n), pg_temp.sid(953, 2), pg_temp.sid(951, n),
  'employee', 'active' from unnest(array[3, 6]) n;
create temporary table identity_before as select
  (select jsonb_agg(to_jsonb(m) order by m.id) from public.memberships m
    where m.user_id in (pg_temp.sid(951, 2), pg_temp.sid(951, 3), pg_temp.sid(951, 9), pg_temp.sid(951, 10))) as memberships,
  (select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u
    where u.id in (select pg_temp.sid(951, n) from generate_series(1, 10) n)) as users,
  (select jsonb_agg(to_jsonb(s) order by s.id) from auth.sessions s
    where s.user_id in (select pg_temp.sid(951, n) from generate_series(1, 10) n)) as sessions;
create temporary table original_facts as select * from public.time_entries
where membership_id in (select pg_temp.sid(955, n) from generate_series(1, 10) n);

set local role authenticated;
select pg_temp.slogin(1);
select ok(exists (
  select 1 from jsonb_array_elements(public.get_manager_correction_requests()->'requests') r
  where r->>'id' = pg_temp.sid(957, 21)::text and r->>'status' = 'pending'
), 'time review includes pending suspended employee request');
select ok(exists (
  select 1 from jsonb_array_elements(public.get_break_corrections(pg_temp.sid(965, 1))->'requests') r
  where r->>'id' = pg_temp.sid(958, 22)::text and r->>'status' = 'pending'
), 'break review includes pending suspended employee request');

create temporary table decisions as
select 'time'::text as family, n * 10 + slot as claim_number,
  case when slot = 1 then 'approve' else 'reject' end as decision,
  pg_temp.time_decide(n * 10 + slot, n * 10 + slot,
    case when slot = 1 then 'approve' else 'reject' end) as result
from unnest(array[2, 3, 9]) n cross join unnest(array[1, 3]) slot
union all
select 'break', n * 10 + slot,
  case when slot = 2 then 'approve' else 'reject' end,
  pg_temp.break_decide(n * 10 + slot, n * 10 + slot,
    case when slot = 2 then 'approve' else 'reject' end)
from unnest(array[2, 3, 9]) n cross join unnest(array[2, 4]) slot;
select is(result->>'result_code', case decision when 'approve' then 'approved' else 'rejected' end,
  family || ' claim ' || claim_number || ' resolves suspended, other-active-tenant or active target')
from decisions order by family, claim_number;
select ok(
  result->>'request_id' = pg_temp.sid(case family when 'time' then 959 else 960 end, claim_number)::text
  and result->>'correction_request_id' = pg_temp.sid(case family when 'time' then 957 else 958 end, claim_number)::text
  and result->>'request_status' = result->>'result_code'
  and (result->>case family when 'time' then 'did_decide' else 'did_transition' end)::boolean
  and ((result->>case family when 'time' then 'time_entry_id' else 'applied_revision_id' end) is not null) = (decision = 'approve'),
  family || ' claim ' || claim_number || ' preserves correlated response semantics'
) from decisions order by family, claim_number;
select is(
  case family when 'time' then pg_temp.time_decide(claim_number, claim_number, decision)
    else pg_temp.break_decide(claim_number, claim_number, decision) end,
  result, family || ' claim ' || claim_number || ' retries replay exact original result'
) from decisions order by family, claim_number;
select throws_ok($$select pg_temp.time_decide(21, 21, 'reject')$$,
  '22023', 'decision_request_id_reused', 'time replay remains bound to decision');
select throws_ok($$select pg_temp.break_decide(22, 22, 'reject')$$,
  '22023', 'break_request_id_reused', 'break replay remains bound to decision');
select throws_ok($$select pg_temp.time_decide(21, 23)$$,
  '22023', 'decision_request_id_reused', 'time replay remains bound to historical request');
select throws_ok($$select pg_temp.break_decide(22, 24)$$,
  '22023', 'break_request_id_reused', 'break replay remains bound to historical request');
select throws_ok($$select pg_temp.time_decide(21, 21, 'approve', 'Andere fictieve notitie')$$,
  '22023', 'decision_request_id_reused', 'time replay remains bound to note payload');
select throws_ok($$select pg_temp.break_decide(22, 22, 'approve', 'Andere fictieve notitie')$$,
  '22023', 'break_request_id_reused', 'break replay remains bound to note payload');

reset role;
select ok(e.started_at = r.proposed_started_at and e.ended_at = r.proposed_ended_at
  and e.version = 2 and e.last_correction_request_id = r.id
  and r.applied_time_entry_id = e.id and r.status = 'approved',
  'time approval applies exact versioned fact for employee ' || n)
from unnest(array[2, 3, 9]) n
join public.correction_requests r on r.id = pg_temp.sid(957, n * 10 + 1)
join public.time_entries e on e.id = r.target_time_entry_id;
select ok(v.employee_membership_id = pg_temp.sid(955, n) and v.organization_id = pg_temp.sid(953, 1)
  and v.worksite_id = pg_temp.sid(954, 1) and v.time_entry_id = r.time_entry_id
  and v.started_at = r.proposed_started_at and v.ended_at = r.proposed_ended_at
  and v.version = 1 and v.origin = 'approved_missed_break' and not v.removed
  and r.status = 'approved' and r.applied_revision_id = v.id,
  'break approval appends exact tenant-bound revision for employee ' || n)
from unnest(array[2, 3, 9]) n
join public.break_correction_requests r on r.id = pg_temp.sid(958, n * 10 + 2)
join public.time_break_revisions v on v.correction_request_id = r.id;
select is(to_jsonb(e), to_jsonb(b), 'rejection and break review preserve original entry ' || e.id)
from public.time_entries e join original_facts b on b.id = e.id
where e.membership_id in (pg_temp.sid(955, 2), pg_temp.sid(955, 3), pg_temp.sid(955, 9))
  and e.id not in (select pg_temp.sid(956, n * 10 + 1) from unnest(array[2, 3, 9]) n);
select is((select count(*) from public.time_breaks
  where organization_id in (pg_temp.sid(953, 1), pg_temp.sid(953, 2))), 0::bigint,
  'historical break decisions never synthesize live break facts');
select is((select count(*) from private.manager_decision_operations
  where employee_membership_id in (pg_temp.sid(955, 2), pg_temp.sid(955, 3), pg_temp.sid(955, 9))), 6::bigint,
  'six time decisions and retries create six operation results');
select is((select count(*) from private.break_correction_decision_operations
  where request_id in (select pg_temp.sid(960, claim_number) from decisions where family = 'break')), 6::bigint,
  'six break decisions and retries create six operation results');
select is((select count(*) from public.audit_events a
  where a.entity_id = pg_temp.sid(case family when 'time' then 957 else 958 end, claim_number)), 1::bigint,
  family || ' claim ' || claim_number || ' has exactly one terminal audit after replay')
from decisions order by family, claim_number;

-- Active targets retain exactly-one-active-membership validation. Historical blocked
-- results remain immutable when later suspension permits a fresh operation.
set local role authenticated;
select pg_temp.slogin(1);
create temporary table unavailable_before as
select pg_temp.time_decide(61, 61) as time_result, pg_temp.break_decide(62, 62) as break_result;
select is((select time_result->>'result_code' from unavailable_before), 'unavailable',
  'active time target with two active memberships remains unavailable');
select is((select break_result->>'result_code' from unavailable_before), 'unavailable',
  'active break target with two active memberships remains unavailable');
select is(public.change_employee_membership_status(pg_temp.sid(964, 6), pg_temp.sid(955, 6), 'suspend', true)->>'result_code',
  'suspended', 'ambiguous active fixture loses historical tenant access without reactivation');
select is(pg_temp.time_decide(61, 61), (select time_result from unavailable_before),
  'time unavailable result replays unchanged after suspension');
select is(pg_temp.break_decide(62, 62), (select break_result from unavailable_before),
  'break unavailable result replays unchanged after suspension');
select is(pg_temp.time_decide(1061, 61)->>'result_code', 'approved',
  'fresh time decision resolves suspended history despite active membership elsewhere');
select is(pg_temp.break_decide(1062, 62)->>'result_code', 'approved',
  'fresh break decision resolves suspended history despite active membership elsewhere');
select is(pg_temp.time_decide(n * 10 + 1, n * 10 + 1)->>'result_code', 'unavailable',
  'invited/inactive time approval remains unavailable for employee ' || n)
from unnest(array[4, 5]) n;
select is(pg_temp.break_decide(n * 10 + 2, n * 10 + 2)->>'result_code', 'unavailable',
  'invited/inactive break approval remains unavailable for employee ' || n)
from unnest(array[4, 5]) n;
-- Existing rejection resolves unavailable claims without facts; do not broaden this repair.
select is(pg_temp.time_decide(n * 10 + 3, n * 10 + 3, 'reject')->>'result_code', 'rejected',
  'legacy invited/inactive time rejection remains available for employee ' || n)
from unnest(array[4, 5]) n;
select is(pg_temp.break_decide(n * 10 + 4, n * 10 + 4, 'reject')->>'result_code', 'rejected',
  'legacy invited/inactive break rejection remains available for employee ' || n)
from unnest(array[4, 5]) n;
select throws_ok($$select pg_temp.time_decide(71, 71)$$, '42501', null,
  'old tenant manager cannot resolve another tenant time claim');
select throws_ok($$select pg_temp.break_decide(72, 72)$$, '42501', null,
  'old tenant manager cannot resolve another tenant break claim');
select pg_temp.slogin(8);
select throws_ok($$select pg_temp.time_decide(1023, 23, 'reject')$$, '42501', null,
  'other manager cannot resolve suspended historical time claim');
select throws_ok($$select pg_temp.break_decide(1024, 24, 'reject')$$, '42501', null,
  'other manager cannot resolve suspended historical break claim');
reset role;
select is((select count(*) from public.audit_events where
  entity_id in (pg_temp.sid(957, 41), pg_temp.sid(957, 51), pg_temp.sid(958, 42), pg_temp.sid(958, 52))),
  0::bigint, 'unavailable approvals create no audit');

-- Suspended employee remains denied after approval and rejection.
select is((select status from public.correction_requests where id = pg_temp.sid(957, n * 10 + 5)),
  'pending', 'withdrawal denial uses still-pending time claim for employee ' || n)
from unnest(array[2, 3]) n;
select is((select status from public.break_correction_requests where id = pg_temp.sid(958, n * 10 + 6)),
  'pending', 'withdrawal denial uses still-pending break claim for employee ' || n)
from unnest(array[2, 3]) n;
set local role authenticated;
select pg_temp.slogin(2);
select throws_ok($$select public.get_employee_time_clock()$$, '42501', null,
  'suspended employee remains denied clock authorization');
select throws_ok($$select public.get_employee_correction_requests()$$, '42501', null,
  'suspended employee remains denied time correction read RPC');
select throws_ok($$select public.get_break_corrections(pg_temp.sid(965, 2))$$, '42501', null,
  'suspended employee remains denied break correction read RPC');
select is((select count(*) from public.organizations), 0::bigint, 'suspended employee sees no organization');
select is((select count(*) from public.memberships), 0::bigint, 'suspended employee sees no tenant membership');
select is((select count(*) from public.time_entries), 0::bigint, 'suspended employee sees no corrected facts');
select is((select count(*) from public.correction_requests), 0::bigint, 'suspended employee sees no time claims');
select is((select count(*) from public.break_correction_requests), 0::bigint, 'suspended employee sees no break claims');
select is((select count(*) from public.time_break_revisions), 0::bigint, 'suspended employee sees no approved break revisions');
select throws_ok($$select public.submit_employee_correction_request(
  pg_temp.sid(966, 1), 'adjustment', pg_temp.sid(956, 21)::text,
  '2010-01-22T09:15', '', '2010-01-22T17:15', '', 'Fictieve reden')$$,
  '42501', null, 'suspended employee cannot submit time correction');
select throws_ok($$select public.withdraw_employee_correction_request(pg_temp.sid(966, 2), pg_temp.sid(957, 25))$$,
  '42501', null, 'suspended employee cannot withdraw time correction');
select throws_ok($$select public.change_break_correction(
  pg_temp.sid(966, 3), 'missed_break', pg_temp.sid(956, 22), null, 1, null,
  '2010-01-23T13:00', '', '2010-01-23T13:30', '', 'Fictieve reden')$$,
  '42501', null, 'suspended employee cannot submit break correction');
select throws_ok($$select public.change_break_correction(
  pg_temp.sid(966, 4), 'withdraw', null, pg_temp.sid(958, 26), null, null, null, null, null, null, null)$$,
  '42501', null, 'suspended employee cannot withdraw break correction');

-- Another valid active tenant may be usable; this never restores historical tenant access.
select pg_temp.slogin(3);
select is((select count(*) from public.organizations where id = pg_temp.sid(953, 1)), 0::bigint,
  'active membership elsewhere never restores old organization read');
select is((select count(*) from public.memberships where id = pg_temp.sid(955, 3)), 0::bigint,
  'active membership elsewhere never restores suspended membership read');
select is((select count(*) from public.time_entries where organization_id = pg_temp.sid(953, 1)), 0::bigint,
  'active membership elsewhere never restores old factual reads');
select is((select count(*) from public.correction_requests where organization_id = pg_temp.sid(953, 1)), 0::bigint,
  'active membership elsewhere never restores old time-claim reads');
select is((select count(*) from public.break_correction_requests where organization_id = pg_temp.sid(953, 1)), 0::bigint,
  'active membership elsewhere never restores old break-claim reads');
select is((select count(*) from public.time_break_revisions where organization_id = pg_temp.sid(953, 1)), 0::bigint,
  'active membership elsewhere never restores old approved revision reads');
select throws_ok($$select public.submit_employee_correction_request(
  pg_temp.sid(966, 11), 'adjustment', pg_temp.sid(956, 31)::text,
  '2010-02-01T09:15', '', '2010-02-01T17:15', '', 'Fictieve reden')$$,
  '22023', 'correction_invalid_target', 'active membership elsewhere cannot submit historical tenant time correction');
select throws_ok($$select public.withdraw_employee_correction_request(pg_temp.sid(966, 12), pg_temp.sid(957, 35))$$,
  '42501', null, 'active membership elsewhere cannot withdraw historical tenant time claim');
select throws_ok($$select public.change_break_correction(
  pg_temp.sid(966, 13), 'missed_break', pg_temp.sid(956, 32), null, 1, null,
  '2010-02-02T13:00', '', '2010-02-02T13:30', '', 'Fictieve reden')$$,
  '42501', null, 'active membership elsewhere cannot submit historical tenant break correction');
select throws_ok($$select public.change_break_correction(
  pg_temp.sid(966, 14), 'withdraw', null, pg_temp.sid(958, 36), null, null, null, null, null, null, null)$$,
  '42501', null, 'active membership elsewhere cannot withdraw historical tenant break claim');

-- Fault on second approval audit (or first rejection audit) must roll back fact,
-- request, earlier audit and operation result together. No membership restoration.
reset role;
create temporary table rollback_before as select
  (select jsonb_agg(to_jsonb(e) order by e.id) from public.time_entries e where membership_id = pg_temp.sid(955, 10)) as facts,
  (select jsonb_agg(to_jsonb(r) order by r.id) from public.correction_requests r where employee_membership_id = pg_temp.sid(955, 10)) as time_claims,
  (select jsonb_agg(to_jsonb(r) order by r.id) from public.break_correction_requests r where employee_membership_id = pg_temp.sid(955, 10)) as break_claims,
  (select count(*) from public.audit_events) as audits;
create function pg_temp.reject_suspended_review_audit()
returns trigger language plpgsql as $$
begin
  if new.action in ('time_entry.adjusted', 'time_break_revision.added',
    'correction_request.rejected', 'break_correction_request.rejected') then
    raise exception using errcode = 'P0001', message = 'synthetic_suspended_audit_failure';
  end if;
  return new;
end;
$$;
create trigger synthetic_suspended_review_audit_failure
before insert on public.audit_events for each row execute function pg_temp.reject_suspended_review_audit();
set local role authenticated;
select pg_temp.slogin(1);
select throws_ok($$select pg_temp.time_decide(101, 101)$$, 'P0001', 'synthetic_suspended_audit_failure',
  'failed time factual audit rolls back suspended approval');
select throws_ok($$select pg_temp.break_decide(102, 102)$$, 'P0001', 'synthetic_suspended_audit_failure',
  'failed break revision audit rolls back suspended approval');
select throws_ok($$select pg_temp.time_decide(103, 103, 'reject')$$, 'P0001', 'synthetic_suspended_audit_failure',
  'failed time rejection audit rolls back suspended rejection');
select throws_ok($$select pg_temp.break_decide(104, 104, 'reject')$$, 'P0001', 'synthetic_suspended_audit_failure',
  'failed break rejection audit rolls back suspended rejection');
reset role;
select is((select jsonb_agg(to_jsonb(e) order by e.id) from public.time_entries e where membership_id = pg_temp.sid(955, 10)),
  (select facts from rollback_before), 'audit failure restores exact time facts and versions');
select is((select jsonb_agg(to_jsonb(r) order by r.id) from public.correction_requests r where employee_membership_id = pg_temp.sid(955, 10)),
  (select time_claims from rollback_before), 'audit failure restores exact pending time claims');
select is((select jsonb_agg(to_jsonb(r) order by r.id) from public.break_correction_requests r where employee_membership_id = pg_temp.sid(955, 10)),
  (select break_claims from rollback_before), 'audit failure restores exact pending break claims');
select is((select count(*) from public.time_break_revisions where employee_membership_id = pg_temp.sid(955, 10)),
  0::bigint, 'audit failure rolls back every inserted break revision');
select is((select count(*) from private.manager_decision_operations where employee_membership_id = pg_temp.sid(955, 10)),
  0::bigint, 'audit failure leaves no time operation result');
select is((select count(*) from private.break_correction_decision_operations where request_id in (pg_temp.sid(960, 102), pg_temp.sid(960, 104))),
  0::bigint, 'audit failure leaves no break operation result');
select is((select count(*) from public.audit_events), (select audits from rollback_before),
  'audit failure rolls back earlier request audits in same transaction');
drop trigger synthetic_suspended_review_audit_failure on public.audit_events;
set local role authenticated;
select pg_temp.slogin(1);
select is(pg_temp.time_decide(101, 101)->>'result_code', 'approved', 'rolled-back time UUID retries safely');
select is(pg_temp.break_decide(102, 102)->>'result_code', 'approved', 'rolled-back break UUID retries safely');
select is(pg_temp.time_decide(103, 103, 'reject')->>'result_code', 'rejected', 'rolled-back time rejection retries safely');
select is(pg_temp.break_decide(104, 104, 'reject')->>'result_code', 'rejected', 'rolled-back break rejection retries safely');
reset role;
select is(
  (select jsonb_agg(to_jsonb(m) order by m.id) from public.memberships m
    where m.user_id in (pg_temp.sid(951, 2), pg_temp.sid(951, 3), pg_temp.sid(951, 9), pg_temp.sid(951, 10))),
  (select memberships from identity_before),
  'all decisions preserve exact membership identity, role, tenant, status, code and timestamps'
);
select is((select status from public.memberships where id = pg_temp.sid(955, 6)), 'suspended',
  'formerly ambiguous target remains suspended after fresh decisions');
select is(
  (select jsonb_agg(to_jsonb(u) order by u.id) from auth.users u
    where u.id in (select pg_temp.sid(951, n) from generate_series(1, 10) n)),
  (select users from identity_before), 'review never changes any fixture Auth user'
);
select is(
  (select jsonb_agg(to_jsonb(s) order by s.id) from auth.sessions s
    where s.user_id in (select pg_temp.sid(951, n) from generate_series(1, 10) n)),
  (select sessions from identity_before), 'review never creates, revokes or modifies any fixture Auth session'
);
select ok(not exists (
  select 1 from public.audit_events where organization_id = pg_temp.sid(953, 1)
    and action in ('correction_request.approved', 'correction_request.rejected',
      'break_correction_request.approved', 'break_correction_request.rejected')
    and (after_data - 'status' <> '{}'::jsonb
      or coalesce(before_data, '{}'::jsonb) - 'status' <> '{}'::jsonb)
), 'terminal claim audits retain exact status-only payloads');
select ok(not exists (
  select 1 from public.audit_events where organization_id = pg_temp.sid(953, 1)
    and action = 'time_entry.adjusted'
    and ((after_data - array['started_at','ended_at','version','origin','correction_request_id']) <> '{}'::jsonb
      or (before_data - array['started_at','ended_at','version','origin','correction_request_id']) <> '{}'::jsonb)
), 'time factual audits retain existing minimal field allowlist');
select ok(not exists (
  select 1 from public.audit_events where organization_id = pg_temp.sid(953, 1)
    and action = 'time_break_revision.added'
    and ((after_data - array['logical_break_id','time_entry_id','version','started_at','ended_at','removed','origin']) <> '{}'::jsonb
      or before_data is not null)
), 'missed break revision audits retain existing minimal field allowlist');
select ok(not exists (
  select 1 from public.audit_events where organization_id = pg_temp.sid(953, 1)
    and (coalesce(before_data, '{}'::jsonb) || coalesce(after_data, '{}'::jsonb))::text
      ~* '(Fictieve|SUSP-REVIEW|example[.]test|display_name|email|employee_code|employee_reason|manager_note|credential|password|token|session|user_id)'
), 'audit payloads gain no name, email, code, reason, credential, token, session or Auth identifier');

select * from finish();
rollback;
