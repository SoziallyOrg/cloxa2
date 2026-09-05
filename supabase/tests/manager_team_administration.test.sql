begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select no_plan();

create function pg_temp.team_id(prefix integer, number integer)
returns uuid language sql immutable as $$
  select (prefix::text || '00000-0000-4000-a000-' || lpad(number::text, 12, '0'))::uuid
$$;

create function pg_temp.team_login(number integer)
returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object(
    'sub', pg_temp.team_id(901, number),
    'session_id', pg_temp.team_id(902, number),
    'role', 'authenticated',
    'aal', 'aal2',
    'amr', jsonb_build_array(jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint))
  )::text, true)::text::void
$$;

insert into auth.users (
  id, email, email_confirmed_at, encrypted_password, banned_until, deleted_at
)
select pg_temp.team_id(901, number), 'team.fixture.' || number || '@example.test',
  case when number = 11 then null else now() - interval '1 day' end,
  'synthetic-not-a-password',
  case when number = 12 then now() + interval '1 day' end,
  case when number = 13 then now() end
from generate_series(1, 13) as number;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select pg_temp.team_id(902, number), pg_temp.team_id(901, number), now(), now(),
  case when number = 8 then now() - interval '1 second' end
from generate_series(1, 13) as number;

insert into public.organizations (id, name, lifecycle_status) values
  (pg_temp.team_id(903, 1), 'Fictieve teamorganisatie', 'research_pilot'),
  (pg_temp.team_id(903, 2), 'Andere fictieve organisatie', 'paid_beta'),
  (pg_temp.team_id(903, 3), 'Geschorste fictieve organisatie', 'suspended');

insert into public.worksites (id, organization_id, name) values
  (pg_temp.team_id(904, 1), pg_temp.team_id(903, 1), 'Fictieve werkplek'),
  (pg_temp.team_id(904, 2), pg_temp.team_id(903, 2), 'Andere werkplek'),
  (pg_temp.team_id(904, 3), pg_temp.team_id(903, 3), 'Geschorste werkplek');

insert into public.memberships (
  id, organization_id, user_id, role, status, employee_code
) values
  (pg_temp.team_id(905, 1), pg_temp.team_id(903, 1), pg_temp.team_id(901, 1), 'manager', 'active', null),
  (pg_temp.team_id(905, 2), pg_temp.team_id(903, 1), pg_temp.team_id(901, 2), 'employee', 'active', 'EMP-2'),
  (pg_temp.team_id(905, 3), pg_temp.team_id(903, 1), pg_temp.team_id(901, 3), 'employee', 'active', 'EMP-3'),
  (pg_temp.team_id(905, 4), pg_temp.team_id(903, 2), pg_temp.team_id(901, 4), 'manager', 'active', null),
  (pg_temp.team_id(905, 5), pg_temp.team_id(903, 2), pg_temp.team_id(901, 5), 'employee', 'active', 'OTHER-5'),
  (pg_temp.team_id(905, 6), pg_temp.team_id(903, 1), pg_temp.team_id(901, 6), 'manager', 'inactive', null),
  (pg_temp.team_id(905, 7), pg_temp.team_id(903, 3), pg_temp.team_id(901, 7), 'manager', 'active', null),
  (pg_temp.team_id(905, 8), pg_temp.team_id(903, 1), pg_temp.team_id(901, 8), 'manager', 'active', null),
  (pg_temp.team_id(905, 10), pg_temp.team_id(903, 1), pg_temp.team_id(901, 10), 'manager', 'active', null),
  (pg_temp.team_id(905, 20), pg_temp.team_id(903, 2), pg_temp.team_id(901, 10), 'manager', 'active', null),
  (pg_temp.team_id(905, 11), pg_temp.team_id(903, 1), pg_temp.team_id(901, 11), 'manager', 'active', null),
  (pg_temp.team_id(905, 12), pg_temp.team_id(903, 1), pg_temp.team_id(901, 12), 'manager', 'active', null),
  (pg_temp.team_id(905, 13), pg_temp.team_id(903, 1), pg_temp.team_id(901, 13), 'manager', 'active', null);

insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
select gen_random_uuid(), manager.user_id, 'Synthetic manager TOTP', 'totp', 'verified', now(), now()
from (select distinct user_id from public.memberships where role = 'manager'
  and user_id::text like '90100000-0000-4000-a000-%') as manager
where exists (select 1 from auth.sessions where auth.sessions.user_id = manager.user_id);
update auth.sessions as session
set factor_id = factor.id, aal = 'aal2'
from auth.mfa_factors as factor
where factor.user_id = session.user_id and factor.factor_type = 'totp'
  and session.user_id::text like '90100000-0000-4000-a000-%';
insert into auth.mfa_amr_claims (id, session_id, created_at, updated_at, authentication_method)
select gen_random_uuid(), session.id, now(), now(), 'totp'
from auth.sessions as session join auth.mfa_factors as factor on factor.id = session.factor_id
where session.user_id::text like '90100000-0000-4000-a000-%';
insert into private.manager_mfa_registrations (auth_user_id, provider_factor_id)
select factor.user_id, factor.id from auth.mfa_factors as factor where factor.factor_type = 'totp'
  and factor.user_id::text like '90100000-0000-4000-a000-%';

insert into public.profiles (user_id, display_name)
select pg_temp.team_id(901, number), case number
  when 2 then '<script>Fictieve medewerker</script>'
  when 3 then 'Tweede fictieve medewerker'
  when 5 then 'Andere fictieve medewerker'
  else 'Fictief profiel ' || number
end
from generate_series(1, 13) as number;

insert into public.invitations (
  id, organization_id, normalized_email, status, invited_by, expires_at,
  accepted_by, accepted_at, revoked_at, created_at
) values
  (pg_temp.team_id(906, 1), pg_temp.team_id(903, 1), 'pending@example.test', 'pending',
    pg_temp.team_id(901, 1), now() + interval '1 day', null, null, null, now() - interval '1 hour'),
  (pg_temp.team_id(906, 2), pg_temp.team_id(903, 1), 'accepted@example.test', 'accepted',
    pg_temp.team_id(901, 1), now() + interval '1 day', pg_temp.team_id(901, 2), now() - interval '30 minutes', null, now() - interval '2 hours'),
  (pg_temp.team_id(906, 3), pg_temp.team_id(903, 1), 'expired@example.test', 'expired',
    pg_temp.team_id(901, 1), now() - interval '1 hour', null, null, null, now() - interval '2 days'),
  (pg_temp.team_id(906, 4), pg_temp.team_id(903, 1), 'revoked@example.test', 'revoked',
    pg_temp.team_id(901, 1), now() + interval '1 day', null, null, now() - interval '10 minutes', now() - interval '3 hours'),
  (pg_temp.team_id(906, 5), pg_temp.team_id(903, 1), 'clock-expired@example.test', 'pending',
    pg_temp.team_id(901, 1), now() - interval '1 minute', null, null, null, now() - interval '2 hours'),
  (pg_temp.team_id(906, 6), pg_temp.team_id(903, 2), 'private-other@example.test', 'pending',
    pg_temp.team_id(901, 4), now() + interval '1 day', null, null, null, now());

insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at, ended_at
) values (
  pg_temp.team_id(907, 1), pg_temp.team_id(903, 1), pg_temp.team_id(905, 2),
  pg_temp.team_id(904, 1), '2010-01-01 08:00Z', '2010-01-01 16:00Z'
), (
  pg_temp.team_id(907, 2), pg_temp.team_id(903, 2), pg_temp.team_id(905, 5),
  pg_temp.team_id(904, 2), '2010-01-01 08:00Z', '2010-01-01 16:00Z'
);

-- Schema, indexes, policies, owners, and grants.
select columns_are('private', 'manager_team_operations', array[
  'request_id','organization_id','actor_membership_id','target_entity_type',
  'target_entity_id','action','payload_hash','result_code','result','processed_at'
]);
select indexes_are('private', 'manager_team_operations', array[
  'manager_team_operations_pkey','manager_team_operations_actor_idx',
  'manager_team_operations_target_idx'
]);
select ok(
  (select relrowsecurity from pg_class where oid = 'private.manager_team_operations'::regclass),
  'manager operation ledger has RLS'
);
select is(
  (select count(*) from pg_policies where schemaname = 'private'
    and tablename = 'manager_team_operations'),
  0::bigint,
  'manager operation ledger has no application policy'
);
select ok(
  not has_table_privilege(role_name, 'private.manager_team_operations', privilege_name),
  role_name || ' denied manager ledger ' || privilege_name
)
from unnest(array['anon','authenticated','service_role']) as role_name,
  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) as privilege_name;
select ok(
  function_record.proowner = 'postgres'::regrole
    and function_record.prosecdef = expected.is_definer
    and function_record.proconfig = array['search_path=""']
    and (
      select array_agg(privilege.grantee::regrole::text order by privilege.grantee::regrole::text)
      from aclexplode(function_record.proacl) as privilege
    ) = case when expected.is_executable
      then array['authenticated','postgres'] else array['postgres'] end,
  expected.signature || ' has exact owner, mode, path, and grants'
)
from (values
  ('private.reject_manager_team_operation_mutation()', false, false),
  ('private.manager_admin_context()', true, true),
  ('private.get_manager_team(uuid)', true, true),
  ('private.update_employee_profile(uuid,uuid,text,text)', true, true),
  ('private.change_employee_membership_status(uuid,uuid,text,boolean)', true, true),
  ('private.update_pilot_settings(uuid,text,text)', true, true),
  ('public.get_manager_team(uuid)', false, true),
  ('public.update_employee_profile(uuid,uuid,text,text)', false, true),
  ('public.change_employee_membership_status(uuid,uuid,text,boolean)', false, true),
  ('public.update_pilot_settings(uuid,text,text)', false, true)
) as expected(signature, is_definer, is_executable)
join pg_proc as function_record on function_record.oid = expected.signature::regprocedure;
select ok(
  exists (select 1 from pg_indexes where schemaname = 'public'
    and indexname = 'memberships_organization_employee_code_normalized_key'),
  'normalized employee code index exists'
);

-- Authorization denials use live role, Auth user, session, one membership, and tenant.
set local role authenticated;
select pg_temp.team_login(2);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 1))$$,
  '42501', null, 'employee cannot enumerate coworkers');
select pg_temp.team_login(6);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 2))$$,
  '42501', null, 'inactive manager denied');
select pg_temp.team_login(7);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 3))$$,
  '42501', null, 'suspended organization denied');
select pg_temp.team_login(8);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 4))$$,
  '42501', null, 'expired session denied');
select pg_temp.team_login(9);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 5))$$,
  '42501', null, 'unaffiliated caller denied');
select pg_temp.team_login(10);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 6))$$,
  '42501', null, 'ambiguous active membership denied');
select pg_temp.team_login(11);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 7))$$,
  '42501', null, 'unverified manager denied');
select pg_temp.team_login(12);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 8))$$,
  '42501', null, 'banned manager denied');
select pg_temp.team_login(13);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 9))$$,
  '42501', null, 'deleted manager denied');
set local "request.jwt.claims" = '{}';
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 10))$$,
  '42501', null, 'sessionless authenticated caller denied');
set local role anon;
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 11))$$,
  '42501', null, 'anonymous denied');
set local role service_role;
select throws_ok($$select public.get_manager_team(pg_temp.team_id(910, 12))$$,
  '42501', null, 'service role has no RPC grant');

-- Exact bounded read model and same-tenant privacy.
set local role authenticated;
select pg_temp.team_login(1);
create temporary table team_view as
select public.get_manager_team(pg_temp.team_id(910, 20)) as value;
select is((select value->>'request_id' from team_view), pg_temp.team_id(910, 20)::text,
  'read model correlates request UUID');
select is(
  array(select jsonb_object_keys(value) from team_view order by 1),
  array['employees','invitations','organization_id','organization_name','request_id',
    'timezone','worksite_id','worksite_name']::text[],
  'read model has exact top-level keys'
);
select is((select value->>'organization_id' from team_view), pg_temp.team_id(903, 1)::text,
  'read model stays in manager tenant');
select is((select value->>'timezone' from team_view), 'Europe/Brussels',
  'read model reports fixed timezone');
select is((select jsonb_array_length(value->'employees') from team_view), 2,
  'read model contains same-tenant employees only');
select is(
  (select array_agg(item->>'account_email' order by item->>'account_email')
    from team_view cross join lateral jsonb_array_elements(value->'employees') as item),
  array['team.fixture.2@example.test','team.fixture.3@example.test']::text[],
  'read model resolves only same-tenant account emails'
);
select is(
  (select array_agg(key order by key)
    from team_view
    cross join lateral jsonb_array_elements(value->'employees') as item
    cross join lateral jsonb_object_keys(item) as key
    where item->>'membership_id' = pg_temp.team_id(905, 2)::text),
  array['account_email','activated_at','created_at','display_name','employee_code',
    'has_open_break','has_open_shift','membership_id','membership_status',
    'pending_break_correction_count','pending_time_correction_count']::text[],
  'employee projection has exact safe keys'
);
select ok(
  (select value::text !~ '(user_id|session_id|token|payload_hash|operation_hash|service_role)'
    from team_view),
  'read model contains no Auth, session, token, hash, or service identifiers'
);
select is(
  (select array_agg(distinct item->>'status' order by item->>'status')
    from team_view cross join lateral jsonb_array_elements(value->'invitations') as item),
  array['accepted','expired','pending','revoked']::text[],
  'invitation projection reports pending, accepted, expired, and revoked'
);
select is(
  (select array_agg(distinct key order by key)
    from team_view
    cross join lateral jsonb_array_elements(value->'invitations') as item
    cross join lateral jsonb_object_keys(item) as key),
  array['accepted_at','created_at','email','expires_at','revoked_at','status']::text[],
  'invitation projection has exact safe keys'
);
select ok(
  not (select value::text like '%private-other@example.test%' from team_view),
  'cross-tenant invitation email is absent'
);

-- Create immutable v1 and v2 exports before future-facing profile/settings updates.
select is((select result_code from public.create_time_export(
  pg_temp.team_id(911, 1), '2010-01-01', '2010-01-01', true
)), 'created', 'v1 export fixture created');
select is(public.create_time_export_v2(
  pg_temp.team_id(911, 2), '2010-01-01', '2010-01-01', true
)->>'result_code', 'created', 'v2 export fixture created');
reset role;
create temporary table frozen_exports as
select
  (select row_to_json(row)::jsonb from private.time_export_rows as row
    where row.organization_id = pg_temp.team_id(903, 1) limit 1) as v1,
  (select snapshot.records from private.time_export_v2_snapshots as snapshot
    where snapshot.organization_id = pg_temp.team_id(903, 1) limit 1) as v2,
  (select export.dataset_sha256 from public.time_exports as export
    where export.organization_id = pg_temp.team_id(903, 1) limit 1) as v1_hash,
  (select export.manifest->>'dataset_sha256' from public.time_exports_v2 as export
    where export.organization_id = pg_temp.team_id(903, 1) limit 1) as v2_hash;

-- Profile validation, normalization, uniqueness, replay, and audit minimality.
set local role authenticated;
select pg_temp.team_login(1);
create temporary table profile_result as
select public.update_employee_profile(
  pg_temp.team_id(912, 1), pg_temp.team_id(905, 2),
  '  Gewijzigde fictieve naam  ', '  PAY-22  '
) as value;
select is((select value->>'result_code' from profile_result), 'updated',
  'profile update succeeds');
select is((select value->>'display_name' from profile_result), 'Gewijzigde fictieve naam',
  'display name is trimmed');
select is((select value->>'employee_code' from profile_result), 'PAY-22',
  'employee code is trimmed');
select is((select value->>'target_membership_id' from profile_result),
  pg_temp.team_id(905, 2)::text, 'profile result correlates target');
select is(
  public.update_employee_profile(
    pg_temp.team_id(912, 1), pg_temp.team_id(905, 2),
    '  Gewijzigde fictieve naam  ', '  PAY-22  '
  ),
  (select value from profile_result),
  'identical profile UUID retry returns exact original result'
);
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(912, 1), pg_temp.team_id(905, 2), 'Andere naam', 'PAY-22'
)$$, '22023', 'manager_team_request_id_reused', 'profile UUID payload reuse fails closed');
select is(public.update_employee_profile(
  pg_temp.team_id(912, 2), pg_temp.team_id(905, 3),
  'Tweede fictieve medewerker', ' pay-22 '
)->>'result_code', 'duplicate_employee_code',
  'normalized same-tenant employee code duplicate is blocked');
select is(public.update_employee_profile(
  pg_temp.team_id(912, 3), pg_temp.team_id(905, 2),
  'Gewijzigde fictieve naam', 'PAY-22'
)->>'result_code', 'unchanged', 'profile no-op is explicit');
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(912, 4), pg_temp.team_id(905, 2), '   ', null
)$$, '22023', 'manager_team_invalid_profile', 'blank display name rejected');
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(912, 5), pg_temp.team_id(905, 2), repeat('x', 101), null
)$$, '22023', 'manager_team_invalid_profile', 'display name bound enforced');
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(912, 6), pg_temp.team_id(905, 2), 'Naam', repeat('x', 33)
)$$, '22023', 'manager_team_invalid_profile', 'employee code bound enforced');
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(912, 7), pg_temp.team_id(905, 1), 'Manager', null
)$$, '42501', null, 'manager target rejected');
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(912, 8), pg_temp.team_id(905, 5), 'Cross tenant', null
)$$, '42501', null, 'cross-tenant profile target rejected');
select is((select count(*) from public.audit_events
  where action = 'employee_profile.updated'), 1::bigint,
  'one real profile change creates one audit');
select is((select after_data from public.audit_events
  where action = 'employee_profile.updated'),
  '{"changed_fields":["display_name","employee_code"]}'::jsonb,
  'profile audit contains changed field names only');

-- Settings update locks export identity fields and preserves fixed snapshots.
create temporary table settings_result as
select public.update_pilot_settings(
  pg_temp.team_id(913, 1), '  Nieuwe fictieve organisatie  ', '  Nieuwe fictieve werkplek  '
) as value;
select is((select value->>'result_code' from settings_result), 'updated',
  'pilot settings update succeeds');
select is((select value->>'organization_name' from settings_result),
  'Nieuwe fictieve organisatie', 'organization name trimmed');
select is((select value->>'worksite_name' from settings_result),
  'Nieuwe fictieve werkplek', 'worksite name trimmed');
select is((select value->>'timezone' from settings_result), 'Europe/Brussels',
  'settings response keeps fixed timezone');
select is(public.update_pilot_settings(
  pg_temp.team_id(913, 1), '  Nieuwe fictieve organisatie  ', '  Nieuwe fictieve werkplek  '
), (select value from settings_result), 'settings replay is exact');
select is(public.update_pilot_settings(
  pg_temp.team_id(913, 2), 'Nieuwe fictieve organisatie', 'Nieuwe fictieve werkplek'
)->>'result_code', 'unchanged', 'settings no-op is explicit');
select throws_ok($$select public.update_pilot_settings(
  pg_temp.team_id(913, 3), '', 'Werkplek'
)$$, '22023', 'manager_team_invalid_settings', 'blank organization name rejected');
select throws_ok($$select public.update_pilot_settings(
  pg_temp.team_id(913, 4), 'Organisatie', repeat('x', 121)
)$$, '22023', 'manager_team_invalid_settings', 'worksite name bound enforced');
select is((select timezone from public.worksites where id = pg_temp.team_id(904, 1)),
  'Europe/Brussels', 'settings cannot change timezone');
select is((select count(*) from public.worksites
  where organization_id = pg_temp.team_id(903, 1)), 1::bigint,
  'settings do not create another worksite');
select is((select count(*) from public.audit_events
  where action in ('organization.settings_updated','worksite.settings_updated')),
  2::bigint, 'changed organization and worksite each create one audit');
reset role;
select is((select row_to_json(row)::jsonb from private.time_export_rows as row
    where row.organization_id = pg_temp.team_id(903, 1) limit 1),
  (select v1 from frozen_exports), 'v1 snapshot bytes input stays unchanged');
select is((select snapshot.records from private.time_export_v2_snapshots as snapshot
    where snapshot.organization_id = pg_temp.team_id(903, 1) limit 1),
  (select v2 from frozen_exports), 'v2 snapshot stays unchanged');
select is((select export.dataset_sha256 from public.time_exports as export
    where export.organization_id = pg_temp.team_id(903, 1) limit 1),
  (select v1_hash from frozen_exports), 'v1 hash stays unchanged');
select is((select export.manifest->>'dataset_sha256' from public.time_exports_v2 as export
    where export.organization_id = pg_temp.team_id(903, 1) limit 1),
  (select v2_hash from frozen_exports), 'v2 hash stays unchanged');

-- Pending correction counts remain visible and do not prevent safe suspension.
insert into public.time_entries(id,organization_id,membership_id,worksite_id,started_at,created_at)
values(pg_temp.team_id(907,20),pg_temp.team_id(903,1),pg_temp.team_id(905,2),pg_temp.team_id(904,1),'2010-01-04 08:00Z','2010-01-04 08:00Z');
insert into public.time_breaks(id,organization_id,employee_membership_id,worksite_id,time_entry_id,started_at,created_at)
values(pg_temp.team_id(919,20),pg_temp.team_id(903,1),pg_temp.team_id(905,2),pg_temp.team_id(904,1),pg_temp.team_id(907,20),
  '2010-01-04 09:00Z','2010-01-04 09:00Z');
update public.time_breaks set ended_at='2010-01-04 09:15Z' where id=pg_temp.team_id(919,20);
update public.time_entries set ended_at='2010-01-04 16:00Z' where id=pg_temp.team_id(907,20);
insert into public.break_correction_requests(id,organization_id,employee_membership_id,worksite_id,time_entry_id,logical_break_id,
  request_kind,parent_version,parent_started_at,parent_ended_at,proposed_started_at,proposed_ended_at,employee_reason,submission_request_id)
values(pg_temp.team_id(914,3),pg_temp.team_id(903,1),pg_temp.team_id(905,2),pg_temp.team_id(904,1),pg_temp.team_id(907,1),pg_temp.team_id(916,3),
  'missed_break',1,'2010-01-01 08:00Z','2010-01-01 16:00Z','2010-01-01 10:00Z','2010-01-01 10:15Z','Fictieve historische pauze',pg_temp.team_id(915,3));
set local role authenticated;
select pg_temp.team_login(1);
select is(public.decide_break_correction(pg_temp.team_id(915,4),pg_temp.team_id(914,3),'approve','',true)->>'result_code','approved',
  'real historical revision created before suspension');
reset role;
insert into public.correction_requests (
  id, organization_id, employee_membership_id, worksite_id, request_kind,
  proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
) values (
  pg_temp.team_id(914, 1), pg_temp.team_id(903, 1), pg_temp.team_id(905, 2),
  pg_temp.team_id(904, 1), 'missed_entry', '2010-01-03 08:00Z',
  '2010-01-03 09:00Z', 'Fictieve tijdcorrectie', pg_temp.team_id(915, 1)
);
insert into public.break_correction_requests (
  id, organization_id, employee_membership_id, worksite_id, time_entry_id,
  logical_break_id, request_kind, parent_version, parent_started_at, parent_ended_at,
  proposed_started_at, proposed_ended_at, employee_reason, submission_request_id
) values (
  pg_temp.team_id(914, 2), pg_temp.team_id(903, 1), pg_temp.team_id(905, 2),
  pg_temp.team_id(904, 1), pg_temp.team_id(907, 1), pg_temp.team_id(916, 1),
  'missed_break', 1, '2010-01-01 08:00Z', '2010-01-01 16:00Z',
  '2010-01-01 12:00Z', '2010-01-01 12:30Z', 'Fictieve pauzecorrectie',
  pg_temp.team_id(915, 2)
);

create function pg_temp.team_history() returns jsonb language sql as $$
  select jsonb_build_object(
    'entries',(select jsonb_agg(to_jsonb(row) order by id) from public.time_entries row),
    'breaks',(select jsonb_agg(to_jsonb(row) order by id) from public.time_breaks row),
    'requests',(select jsonb_agg(to_jsonb(row) order by id) from public.correction_requests row),
    'break_requests',(select jsonb_agg(to_jsonb(row) order by id) from public.break_correction_requests row),
    'revisions',(select jsonb_agg(to_jsonb(row) order by id) from public.time_break_revisions row),
    'v1',(select jsonb_agg(to_jsonb(row) order by id) from public.time_exports row),
    'v2',(select jsonb_agg(to_jsonb(row) order by id) from public.time_exports_v2 row),
    'v1_rows',(select jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text) from private.time_export_rows row),
    'v2_rows',(select jsonb_agg(to_jsonb(row) order by to_jsonb(row)::text) from private.time_export_v2_snapshots row),
    'invitations',(select jsonb_agg(to_jsonb(row) order by id) from public.invitations row),
    'auth',(select to_jsonb(row) from auth.users row where id=pg_temp.team_id(901,2)),
    'sessions',(select jsonb_agg(to_jsonb(row) order by id) from auth.sessions row where user_id=pg_temp.team_id(901,2)),
    'profile',(select to_jsonb(row) from public.profiles row where user_id=pg_temp.team_id(901,2))
  );
$$;
create temporary table frozen_history as select pg_temp.team_history() as value;
create temporary table preservation_before as
select
  (select count(*) from public.time_entries) as facts,
  (select count(*) from public.correction_requests) as time_requests,
  (select count(*) from public.break_correction_requests) as break_requests,
  (select count(*) from public.time_break_revisions) as revisions,
  (select count(*) from public.time_exports) as v1_exports,
  (select count(*) from public.time_exports_v2) as v2_exports,
  (select count(*) from public.invitations) as invitations;

set local role authenticated;
select pg_temp.team_login(1);
select is(public.change_employee_membership_status(
  pg_temp.team_id(917, 1), pg_temp.team_id(905, 2), 'suspend', false
)->>'result_code', 'confirmation_required', 'suspension requires confirmation');
create temporary table suspend_result as
select public.change_employee_membership_status(
  pg_temp.team_id(917, 2), pg_temp.team_id(905, 2), 'suspend', true
) as value;
select is((select value->>'result_code' from suspend_result), 'suspended',
  'active employee suspended');
select is((select value->>'membership_status' from suspend_result), 'suspended',
  'suspension returns resulting status');
select is((select value->>'pending_time_correction_count' from suspend_result), '1',
  'suspension returns pending time correction count');
select is((select value->>'pending_break_correction_count' from suspend_result), '1',
  'suspension returns pending break correction count');
select is(public.change_employee_membership_status(
  pg_temp.team_id(917, 2), pg_temp.team_id(905, 2), 'suspend', true
), (select value from suspend_result), 'suspension replay is exact');
select is(public.change_employee_membership_status(
  pg_temp.team_id(917, 3), pg_temp.team_id(905, 2), 'suspend', true
)->>'result_code', 'already_suspended', 'repeated suspension is safe no-op');
select is((select count(*) from public.audit_events
  where action = 'employee_membership.suspended'), 1::bigint,
  'one real suspension creates one audit');
select throws_ok($$select public.change_employee_membership_status(
  pg_temp.team_id(917, 4), pg_temp.team_id(905, 1), 'suspend', true
)$$, '42501', null, 'manager cannot be suspended');
select throws_ok($$select public.change_employee_membership_status(
  pg_temp.team_id(917, 5), pg_temp.team_id(905, 5), 'suspend', true
)$$, '42501', null, 'cross-tenant employee cannot be suspended');

select pg_temp.team_login(2);
select is((select authorization_state from public.get_auth_context()), 'unauthorized',
  'suspended employee loses application authorization immediately');
select is((select count(*) from public.time_entries), 0::bigint,
  'suspended employee cannot read organization facts');
select is((select count(*) from public.memberships), 0::bigint,
  'suspended employee cannot read membership row');

reset role;
select is((select facts from preservation_before),
  (select count(*) from public.time_entries), 'suspension preserves time facts');
select is((select time_requests from preservation_before),
  (select count(*) from public.correction_requests), 'suspension preserves time requests');
select is((select break_requests from preservation_before),
  (select count(*) from public.break_correction_requests), 'suspension preserves break requests');
select is((select revisions from preservation_before),
  (select count(*) from public.time_break_revisions), 'suspension preserves break revisions');
select is((select v1_exports from preservation_before),
  (select count(*) from public.time_exports), 'suspension preserves v1 exports');
select is((select v2_exports from preservation_before),
  (select count(*) from public.time_exports_v2), 'suspension preserves v2 exports');
select is((select invitations from preservation_before),
  (select count(*) from public.invitations), 'suspension preserves invitations');
select is(pg_temp.team_history(),(select value from frozen_history),
  'suspension leaves complete facts, breaks, claims, revisions, exports, invitations, Auth, sessions and profile byte values unchanged');

-- Reactivation fails closed with another active membership, then restores same row.
insert into public.memberships (
  id, organization_id, user_id, role, status, employee_code
) values (
  pg_temp.team_id(905, 22), pg_temp.team_id(903, 2), pg_temp.team_id(901, 2),
  'employee', 'active', 'OTHER-22'
);
set local role authenticated;
select pg_temp.team_login(1);
select is(public.change_employee_membership_status(
  pg_temp.team_id(918, 1), pg_temp.team_id(905, 2), 'reactivate', true
)->>'result_code', 'ambiguous_membership', 'reactivation rejects second active membership');
reset role;
update public.memberships set status = 'inactive' where id = pg_temp.team_id(905, 22);
set local role authenticated;
select pg_temp.team_login(1);
create temporary table reactivate_result as
select public.change_employee_membership_status(
  pg_temp.team_id(918, 2), pg_temp.team_id(905, 2), 'reactivate', true
) as value;
select is((select value->>'result_code' from reactivate_result), 'reactivated',
  'suspended employee reactivated');
select is(public.change_employee_membership_status(
  pg_temp.team_id(918, 2), pg_temp.team_id(905, 2), 'reactivate', true
), (select value from reactivate_result), 'reactivation replay is exact');
select is(public.change_employee_membership_status(
  pg_temp.team_id(918, 3), pg_temp.team_id(905, 2), 'reactivate', true
)->>'result_code', 'already_active', 'repeated reactivation is safe no-op');
select is((select count(*) from public.memberships
  where id = pg_temp.team_id(905, 2)), 1::bigint,
  'reactivation restores same membership without duplicate');
select is((select count(*) from public.audit_events
  where action = 'employee_membership.reactivated'), 1::bigint,
  'one real reactivation creates one audit');

-- Open shift and open break prevent suspension and remain untouched.
reset role;
insert into public.time_entries (
  id, organization_id, membership_id, worksite_id, started_at
) values (
  pg_temp.team_id(907, 3), pg_temp.team_id(903, 1), pg_temp.team_id(905, 3),
  pg_temp.team_id(904, 1), now() - interval '2 hours'
);
insert into public.time_breaks (
  id, organization_id, employee_membership_id, worksite_id, time_entry_id, started_at,
  created_at
) values (
  pg_temp.team_id(919, 1), pg_temp.team_id(903, 1), pg_temp.team_id(905, 3),
  pg_temp.team_id(904, 1), pg_temp.team_id(907, 3), now() - interval '1 hour',
  now() - interval '1 hour'
);
set local role authenticated;
select pg_temp.team_login(1);
create temporary table break_blocker as
select public.change_employee_membership_status(
  pg_temp.team_id(919, 2), pg_temp.team_id(905, 3), 'suspend', true
) as value;
select is((select value->>'result_code' from break_blocker), 'open_break',
  'open break blocks suspension');
select is((select value->>'has_open_shift' from break_blocker), 'true',
  'blocker reports open shift');
select is((select value->>'has_open_break' from break_blocker), 'true',
  'blocker reports open break');
reset role;
update public.time_breaks set ended_at = now() - interval '30 minutes'
where id = pg_temp.team_id(919, 1);
set local role authenticated;
select pg_temp.team_login(1);
select is(public.change_employee_membership_status(
  pg_temp.team_id(919, 3), pg_temp.team_id(905, 3), 'suspend', true
)->>'result_code', 'open_shift', 'open shift blocks suspension after break closes');
select is((select status from public.memberships where id = pg_temp.team_id(905, 3)),
  'active', 'blocked suspension leaves membership active');

-- Direct unique constraint and operation-ledger mutation guards.
reset role;
select throws_ok($$update public.memberships set employee_code = ' pay-22 '
  where id = pg_temp.team_id(905, 3)$$, '23505', null,
  'database unique index enforces trimmed case-insensitive code uniqueness');
select throws_ok($$update private.manager_team_operations set result_code = 'forged'
  where request_id = pg_temp.team_id(912, 1)$$,
  '55000', 'manager_team_operations are append-only', 'ledger UPDATE guarded');
select throws_ok($$delete from private.manager_team_operations
  where request_id = pg_temp.team_id(912, 1)$$,
  '55000', 'manager_team_operations are append-only', 'ledger DELETE guarded');
select throws_ok($$truncate table private.manager_team_operations$$,
  '55000', 'manager_team_operations are append-only', 'ledger TRUNCATE guarded');

-- Audit insertion failure rolls profile change and operation result back atomically.
create function pg_temp.reject_phase9_audit()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.action = 'employee_profile.updated' then
    raise exception using errcode = 'P0001', message = 'phase9_test_audit_failure';
  end if;
  return new;
end;
$$;
create trigger reject_phase9_audit
before insert on public.audit_events
for each row execute function pg_temp.reject_phase9_audit();
set local role authenticated;
select pg_temp.team_login(1);
select throws_ok($$select public.update_employee_profile(
  pg_temp.team_id(920, 1), pg_temp.team_id(905, 2), 'Rollback naam', 'PAY-22'
)$$, 'P0001', 'phase9_test_audit_failure', 'failed audit aborts profile operation');
reset role;
select is((select display_name from public.profiles where user_id = pg_temp.team_id(901, 2)),
  'Gewijzigde fictieve naam', 'failed audit rolls profile value back');
select is((select count(*) from private.manager_team_operations
  where request_id = pg_temp.team_id(920, 1)), 0::bigint,
  'failed audit rolls operation result back');
drop trigger reject_phase9_audit on public.audit_events;

-- Audits exclude changed text, emails, notes, secrets, and Auth/session identifiers.
select ok(
  not exists (
    select 1 from public.audit_events as event
    where event.action in (
      'employee_profile.updated','employee_membership.suspended',
      'employee_membership.reactivated','organization.settings_updated',
      'worksite.settings_updated'
    ) and concat_ws(' ', event.before_data::text, event.after_data::text) ~
      '(Gewijzigde|PAY-22|example\\.test|session|token|password|secret)'
  ),
  'Phase 9 audit payloads exclude profile text, email, secrets, and session data'
);
select is(
  (select array_agg(distinct action order by action) from public.audit_events
    where action like 'employee_%' or action like '%settings_updated'),
  array['employee_membership.reactivated','employee_membership.suspended',
    'employee_profile.updated','organization.settings_updated',
    'worksite.settings_updated']::text[],
  'Phase 9 audit action set is exact'
);

-- Every mutation independently rejects unsupported actors before writing a result.
create function pg_temp.denied_team_mutations(number integer)
returns setof text language plpgsql as $$
begin
  perform pg_temp.team_login(number);
  return next throws_ok('select public.update_employee_profile(pg_temp.team_id(921,1), pg_temp.team_id(905,2), ''Denied'', null)',
    '42501', null, 'profile denies actor ' || number);
  return next throws_ok('select public.change_employee_membership_status(pg_temp.team_id(921,2), pg_temp.team_id(905,2), ''suspend'', true)',
    '42501', null, 'suspension denies actor ' || number);
  return next throws_ok('select public.change_employee_membership_status(pg_temp.team_id(921,3), pg_temp.team_id(905,2), ''reactivate'', true)',
    '42501', null, 'reactivation denies actor ' || number);
  return next throws_ok('select public.update_pilot_settings(pg_temp.team_id(921,4), ''Denied'', ''Denied'')',
    '42501', null, 'settings deny actor ' || number);
end;
$$;
set local role authenticated;
select pg_temp.denied_team_mutations(number)
from unnest(array[2,3,6,7,8,9,10,11,12,13]) as number;
select pg_temp.team_login(1);
set local role anon;
select throws_ok($$select public.update_employee_profile(pg_temp.team_id(921,1),pg_temp.team_id(905,2),'Denied',null)$$, '42501', null, 'anonymous profile denied');
select throws_ok($$select public.change_employee_membership_status(pg_temp.team_id(921,2),pg_temp.team_id(905,2),'suspend',true)$$, '42501', null, 'anonymous status denied');
select throws_ok($$select public.update_pilot_settings(pg_temp.team_id(921,3),'Denied','Denied')$$, '42501', null, 'anonymous settings denied');
set local role service_role;
select throws_ok($$select public.update_employee_profile(pg_temp.team_id(921,1),pg_temp.team_id(905,2),'Denied',null)$$, '42501', null, 'service-role profile denied despite manager claims');
select throws_ok($$select public.change_employee_membership_status(pg_temp.team_id(921,2),pg_temp.team_id(905,2),'suspend',true)$$, '42501', null, 'service-role status denied despite manager claims');
select throws_ok($$select public.update_pilot_settings(pg_temp.team_id(921,3),'Denied','Denied')$$, '42501', null, 'service-role settings denied despite manager claims');
set local role authenticated;
select pg_temp.team_login(1);
select throws_ok($$select public.change_employee_membership_status(pg_temp.team_id(921,4),pg_temp.team_id(905,2),null,true)$$,
  '22023','manager_team_invalid_status_change','NULL action rejected');
select throws_ok($$select public.update_employee_profile(pg_temp.team_id(921,5),pg_temp.team_id(905,2),E'Bad\nName',null)$$,
  '22023','manager_team_invalid_profile','profile control character rejected');
select throws_ok($$select public.update_pilot_settings(pg_temp.team_id(921,6),E'Bad\tName','Werkplek')$$,
  '22023','manager_team_invalid_settings','settings control character rejected');
select throws_ok($$select public.update_employee_profile(pg_temp.team_id(912,1),pg_temp.team_id(905,3),'Gewijzigde fictieve naam','PAY-22')$$,
  '22023','manager_team_request_id_reused','same UUID cannot change target');
select throws_ok($$select public.change_employee_membership_status(pg_temp.team_id(912,1),pg_temp.team_id(905,2),'suspend',true)$$,
  '22023','manager_team_request_id_reused','same UUID cannot change RPC/action');
reset role;
update public.memberships set status='active' where id=pg_temp.team_id(905,6);
set local role authenticated;
select pg_temp.team_login(6);
select throws_ok($$select public.update_employee_profile(pg_temp.team_id(912,1),pg_temp.team_id(905,2),'Gewijzigde fictieve naam','PAY-22')$$,
  '22023','manager_team_request_id_reused','same UUID cannot change actor');
select pg_temp.team_login(1);
select is(public.update_employee_profile(pg_temp.team_id(922,1),pg_temp.team_id(905,2),'Gewijzigde fictieve naam','   ')->>'employee_code',null,
  'blank optional code becomes NULL');
select is(public.update_employee_profile(pg_temp.team_id(922,2),pg_temp.team_id(905,2),'Gewijzigde fictieve naam','OTHER-5')->>'result_code','updated',
  'same code permitted in another organization');
select is(public.update_employee_profile(pg_temp.team_id(922,3),pg_temp.team_id(905,2),'Gewijzigde fictieve naam','PAY-22')->>'result_code','updated',
  'code restored for following synthetic checks');
select throws_ok($$update public.organizations set name='Browser write' where id=pg_temp.team_id(903,1)$$,'42501',null,'no direct organization UPDATE grant');
select throws_ok($$update public.worksites set name='Browser write' where id=pg_temp.team_id(904,1)$$,'42501',null,'no direct worksite UPDATE grant');
select throws_ok($$update public.memberships set status='suspended' where id=pg_temp.team_id(905,2)$$,'42501',null,'no direct membership UPDATE grant');
select throws_ok($$select email from auth.users$$,'42501',null,'no browser auth.users grant');
select pg_temp.team_login(2);
select lives_ok($$update public.profiles set display_name='Eigen fictieve naam',locale='nl-BE' where user_id=auth.uid()$$,
  'employee retains own display-name and locale permissions');
select throws_ok($$update public.profiles set user_id=pg_temp.team_id(901,3) where user_id=auth.uid()$$,
  '42501',null,'employee profile identity remains protected');
reset role;
select is((select display_name from public.profiles where user_id=pg_temp.team_id(901,2)),'Eigen fictieve naam','self profile edit applied');

-- Conflict-safe acceptance keeps legacy invitation payload immutable and code optional.
insert into public.invitations(organization_id,normalized_email,invited_by,expires_at,employee_code)
values(pg_temp.team_id(903,1),'team.fixture.9@example.test',pg_temp.team_id(901,1),now()+interval '1 day','pay-22');
set local role authenticated;
select pg_temp.team_login(9);
select ok(public.accept_employee_invitation() is not null,'existing invitation code collision does not block authorized acceptance');
select is((select employee_code from public.memberships where user_id=auth.uid()),null,'conflicting proposed code remains unassigned');
reset role;
select is((select employee_code from public.invitations where normalized_email='team.fixture.9@example.test'),'pay-22','acceptance preserves invitation proposed code');
select is((select count(*) from public.memberships where lower(btrim(employee_code))='pay-22'),1::bigint,'acceptance never duplicates normalized code');

-- Audit failure also rolls back status and both settings, including an earlier audit.
create or replace function pg_temp.reject_phase9_audit()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.action in ('employee_membership.suspended','worksite.settings_updated') then
    raise exception using errcode='P0001',message='phase9_test_audit_failure';
  end if;
  return new;
end;
$$;
create trigger reject_phase9_audit before insert on public.audit_events
for each row execute function pg_temp.reject_phase9_audit();
create temporary table settings_before as select name from public.organizations where id=pg_temp.team_id(903,1);
create temporary table audits_before as select count(*) as count from public.audit_events;
set local role authenticated;
select pg_temp.team_login(1);
select throws_ok($$select public.change_employee_membership_status(pg_temp.team_id(923,1),pg_temp.team_id(905,2),'suspend',true)$$,
  'P0001','phase9_test_audit_failure','suspension audit failure aborts transaction');
select throws_ok($$select public.update_pilot_settings(pg_temp.team_id(923,2),'Rollback organisatie','Rollback werkplek')$$,
  'P0001','phase9_test_audit_failure','second settings audit failure aborts both changes');
reset role;
select is((select status from public.memberships where id=pg_temp.team_id(905,2)),'active','failed suspension preserves access');
select is((select name from public.organizations where id=pg_temp.team_id(903,1)),(select name from settings_before),'failed second settings audit restores organization');
select is((select count(*) from public.audit_events),(select count from audits_before),'failed second settings audit removes first settings audit');
select is((select count(*) from private.manager_team_operations where request_id in(pg_temp.team_id(923,1),pg_temp.team_id(923,2))),0::bigint,'failed audit leaves neither operation result');
drop trigger reject_phase9_audit on public.audit_events;

-- A changed worksite cardinality/timezone invalidates every manager operation.
update public.worksites set timezone='UTC' where id=pg_temp.team_id(904,1);
set local role authenticated;
select pg_temp.denied_team_mutations(1);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(924,1))$$,'42501',null,'non-Brussels site read denied');
reset role;
update public.worksites set timezone='Europe/Brussels' where id=pg_temp.team_id(904,1);
insert into public.worksites(id,organization_id,name) values(pg_temp.team_id(904,99),pg_temp.team_id(903,1),'Unsupported second site');
set local role authenticated;
select pg_temp.denied_team_mutations(1);
select throws_ok($$select public.get_manager_team(pg_temp.team_id(924,2))$$,'42501',null,'multiple-worksite read denied');
reset role;
delete from public.worksites where id=pg_temp.team_id(904,99);

-- Bounded deterministic projection, including absent/deleted account email.
update auth.users set email=null where id=pg_temp.team_id(901,3);
set local role authenticated;
select pg_temp.team_login(1);
select is((select employee->>'account_email' from jsonb_array_elements(public.get_manager_team(pg_temp.team_id(925,1))->'employees') employee where employee->>'membership_id'=pg_temp.team_id(905,3)::text),null,'absent account email is not invented');
reset role;
insert into auth.users(id) select pg_temp.team_id(901,number) from generate_series(100,204) number;
insert into public.memberships(id,organization_id,user_id,role,status)
select pg_temp.team_id(905,number),pg_temp.team_id(903,1),pg_temp.team_id(901,number),'employee','invited' from generate_series(100,204) number;
insert into public.invitations(organization_id,normalized_email,invited_by,expires_at)
select pg_temp.team_id(903,1),'bounded.'||number||'@example.test',pg_temp.team_id(901,1),now()+interval '1 day' from generate_series(100,204) number;
set local role authenticated;
select pg_temp.team_login(1);
select is(jsonb_array_length(public.get_manager_team(pg_temp.team_id(925,2))->'employees'),100,'employee projection capped at 100');
select is(jsonb_array_length(public.get_manager_team(pg_temp.team_id(925,2))->'invitations'),100,'invitation projection capped at 100');
select is(public.get_manager_team(pg_temp.team_id(925,2)),public.get_manager_team(pg_temp.team_id(925,2)),'deterministic bounded projection');

select * from finish();
rollback;
