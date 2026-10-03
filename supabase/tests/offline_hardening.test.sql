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

select plan(17);

-- Fixtures (rolled back). One org with the default skew (240 minutes):
-- owner u1; employees u2 (skew), u3 (kiosk event later), u4 (correction
-- event later), u5 (20 pending requests). All at site S.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000080' || n)::uuid, 'offline-hardening-u' || n || '@example.test'
from generate_series(1, 5) as n;

insert into public.organizations (id, name)
values ('10000000-0000-4000-8000-00000000080a', 'Offline hardening org');

insert into public.sites (id, organization_id, name)
values ('20000000-0000-4000-8000-0000000008a1', '10000000-0000-4000-8000-00000000080a', 'Site S');

insert into public.memberships (organization_id, user_id, role, status)
select '10000000-0000-4000-8000-00000000080a', ('00000000-0000-4000-8000-00000000080' || n)::uuid,
  case when n = 1 then 'owner' else 'employee' end, 'active'
from generate_series(1, 5) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000080' || n)::uuid, '10000000-0000-4000-8000-00000000080a',
  ('00000000-0000-4000-8000-00000000080' || n)::uuid, 'Hardening employee ' || n
from generate_series(1, 5) as n;

insert into public.site_assignments (organization_id, site_id, employee_id)
select '10000000-0000-4000-8000-00000000080a', '20000000-0000-4000-8000-0000000008a1',
  ('40000000-0000-4000-8000-00000000080' || n)::uuid
from generate_series(2, 5) as n;

create temporary table r (label text, outcome text, event_id uuid, correction_id uuid, reason text) on commit drop;
grant select, insert on r to authenticated;

create function pg_temp.sync(p_label text, p_type text, p_key text, p_captured timestamptz)
returns void
language sql
as $$
  insert into r
  select p_label, result.*
  from public.rpc_clock_offline(p_type, p_key::uuid, '20000000-0000-4000-8000-0000000008a1', p_captured) as result;
$$;

-- The setting ---------------------------------------------------------------------------

select throws_ok(
  $$update public.organizations
    set settings = settings || '{"offline_max_skew_minutes": 0}'
    where id = '10000000-0000-4000-8000-00000000080a'$$,
  '23514', null, 'offline_max_skew_minutes must be at least 1'
);
select throws_ok(
  $$update public.organizations
    set settings = settings || '{"offline_max_skew_minutes": 4321}'
    where id = '10000000-0000-4000-8000-00000000080a'$$,
  '23514', null, 'offline_max_skew_minutes stays within the 72-hour cap'
);
select is(
  private.offline_max_skew_minutes('10000000-0000-4000-8000-00000000080a'), 240,
  'the default skew is 240 minutes'
);

-- u2: skew beyond the setting ------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000802');

select pg_temp.sync('skew', 'clock_in', '50000000-0000-4000-8000-000000000801', now() - interval '5 hours');
select results_eq(
  $$select outcome, event_id, reason from r where label = 'skew'$$,
  $$values ('correction_requested'::text, null::uuid, 'offline_skew'::text)$$,
  'captured 5 hours before the sync: a correction request (offline_skew)'
);
select is(
  (select offline_reason from public.correction_requests where id = (select correction_id from r where label = 'skew')),
  'offline_skew', 'the request records the skew as its offline reason'
);

-- The owner approves it; a replay still answers with the original request.
select pg_temp.login('00000000-0000-4000-8000-000000000801', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select correction_id from r where label = 'skew'), 'approved')),
  'approved', 'the skew request is approved'
);
select pg_temp.login('00000000-0000-4000-8000-000000000802');
select pg_temp.sync('skew again', 'clock_in', '50000000-0000-4000-8000-000000000801', now() - interval '5 hours');
select results_eq(
  $$select outcome, correction_id, reason from r where label = 'skew again'$$,
  $$select outcome, correction_id, reason from r where label = 'skew'$$,
  'a replay after approval returns the original request'
);

select pg_temp.sync('skew 2', 'break_start', '50000000-0000-4000-8000-000000000802', now() - interval '4 hours 30 minutes');
select is((select reason from r where label = 'skew 2'), 'offline_skew', 'a second skewed event is a request too');
select pg_temp.login('00000000-0000-4000-8000-000000000801', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select correction_id from r where label = 'skew 2'), 'rejected', 'Niet juist')),
  'rejected', 'the second request is rejected'
);
select pg_temp.login('00000000-0000-4000-8000-000000000802');
select pg_temp.sync('skew 2 again', 'break_start', '50000000-0000-4000-8000-000000000802', now() - interval '4 hours 30 minutes');
select results_eq(
  $$select outcome, correction_id, reason from r where label = 'skew 2 again'$$,
  $$select outcome, correction_id, reason from r where label = 'skew 2'$$,
  'a replay after rejection returns the original request, not a new one'
);

select pg_temp.sync('fresh', 'break_start', '50000000-0000-4000-8000-000000000803', now() - interval '3 hours');
select is((select outcome from r where label = 'fresh'), 'recorded', 'within the skew setting: recorded');
reset role;

-- u3: a later kiosk event -------------------------------------------------------------------

insert into public.kiosk_devices (id, organization_id, site_id, name, created_by)
values ('60000000-0000-4000-8000-000000000801', '10000000-0000-4000-8000-00000000080a',
  '20000000-0000-4000-8000-0000000008a1', 'Toestel', '00000000-0000-4000-8000-000000000801');
insert into public.clock_events (organization_id, site_id, employee_id, type, occurred_at, source, device_id,
  idempotency_key, prev_hash, hash)
values ('10000000-0000-4000-8000-00000000080a', '20000000-0000-4000-8000-0000000008a1',
  '40000000-0000-4000-8000-000000000803', 'clock_in', now(), 'kiosk', '60000000-0000-4000-8000-000000000801',
  gen_random_uuid(), '\x00', '\x00');

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000803');
select pg_temp.sync('kiosk', 'clock_in', '50000000-0000-4000-8000-000000000811', now() - interval '10 minutes');
select results_eq(
  $$select outcome, reason from r where label = 'kiosk'$$,
  $$values ('correction_requested'::text, 'later_event_exists'::text)$$,
  'a later kiosk event: correction requested'
);

-- u4: a later correction event ----------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000804');
insert into r (label, correction_id)
select 'add', id from public.rpc_request_correction(
  'add', '{}', jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
    'type', 'clock_in', 'occurred_at', now() - interval '20 minutes',
    'site_id', '20000000-0000-4000-8000-0000000008a1'))), 'Vergeten');
select pg_temp.login('00000000-0000-4000-8000-000000000801', '1 minute');
select is(
  (select status from public.rpc_decide_correction((select correction_id from r where label = 'add'), 'approved')),
  'approved', 'u4 has an approved correction event at -20 minutes'
);
select pg_temp.login('00000000-0000-4000-8000-000000000804');
select pg_temp.sync('corrected', 'clock_in', '50000000-0000-4000-8000-000000000821', now() - interval '30 minutes');
select results_eq(
  $$select outcome, reason from r where label = 'corrected'$$,
  $$values ('correction_requested'::text, 'later_event_exists'::text)$$,
  'a later correction event: correction requested'
);
reset role;

-- u5: the pending cap ---------------------------------------------------------------------------

insert into public.correction_requests (organization_id, employee_id, requested_by, kind, proposed, reason)
select '10000000-0000-4000-8000-00000000080a', '40000000-0000-4000-8000-000000000805',
  '00000000-0000-4000-8000-000000000805', 'add',
  jsonb_build_object('events', jsonb_build_array(jsonb_build_object(
    'type', 'clock_in', 'occurred_at', now() - n * interval '1 day',
    'site_id', '20000000-0000-4000-8000-0000000008a1'))),
  'Vergeten'
from generate_series(1, 20) as n;

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000805');
select pg_temp.sync('cap', 'clock_in', '50000000-0000-4000-8000-000000000831', now() - interval '5 hours');
select results_eq(
  $$select outcome, reason from r where label = 'cap'$$,
  $$values ('rejected'::text, 'too_many_pending'::text)$$,
  'with 20 pending requests a request-bound event is rejected'
);
select is(
  (select count(*) from public.correction_requests where idempotency_key = '50000000-0000-4000-8000-000000000831'),
  0::bigint, 'nothing was stored for it'
);
reset role;

select is(private.verify_clock_chain('10000000-0000-4000-8000-00000000080a'), null, 'the chain verifies');

select * from finish();
rollback;
