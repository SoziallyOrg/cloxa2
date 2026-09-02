begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(103);

-- Transaction-only identities: no passwords, sessions, email delivery, or login setup.
insert into auth.users (id, email) values
  ('72000000-0000-4000-8000-000000000001', 'boundary.manager-a@example.test'),
  ('72000000-0000-4000-8000-000000000002', 'boundary.employee-a@example.test'),
  ('72000000-0000-4000-8000-000000000003', 'boundary.manager-b@example.test'),
  ('72000000-0000-4000-8000-000000000004', 'boundary.inactive-manager@example.test'),
  ('72000000-0000-4000-8000-000000000005', 'boundary.suspended-manager@example.test');

insert into public.profiles (user_id, display_name, created_at, updated_at)
select id, 'Synthetic boundary profile', '2000-01-01Z', '2000-01-01Z'
from auth.users
where id in (
  '72000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002',
  '72000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000004',
  '72000000-0000-4000-8000-000000000005'
);

insert into public.organizations (id, name, lifecycle_status) values
  ('71000000-0000-4000-8000-000000000001', 'Boundary organization A', 'research_pilot'),
  ('71000000-0000-4000-8000-000000000002', 'Boundary organization B', 'paid_beta'),
  ('71000000-0000-4000-8000-000000000003', 'Boundary suspended organization', 'suspended');

insert into public.memberships (organization_id, user_id, role, status) values
  ('71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'manager', 'active'),
  ('71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000002', 'employee', 'active'),
  ('71000000-0000-4000-8000-000000000002', '72000000-0000-4000-8000-000000000003', 'manager', 'active'),
  ('71000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000004', 'manager', 'inactive'),
  ('71000000-0000-4000-8000-000000000003', '72000000-0000-4000-8000-000000000005', 'manager', 'active');

insert into public.audit_events (organization_id, entity_type, entity_id, action)
select id, 'organization', id, 'synthetic_boundary_fixture'
from public.organizations
where id in (
  '71000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000002',
  '71000000-0000-4000-8000-000000000003'
);

-- Privileges and policies are separate layers. Include PostgreSQL 17 MAINTAIN.

select is(
  array(
    select privilege_name
    from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privileges(privilege_name)
    where has_table_privilege(expected.role_name, 'public.audit_events', privilege_name)
    order by privilege_name
  ),
  expected.allowed,
  expected.role_name || ' has exactly the intended audit table privileges'
)
from (values
  ('anon', array[]::text[]),
  ('authenticated', array['SELECT']::text[]),
  ('service_role', array['SELECT']::text[])
) as expected(role_name, allowed);

select ok(
  not (select rolbypassrls or rolsuper from pg_catalog.pg_roles where rolname = 'anon')
  and not (select rolbypassrls or rolsuper from pg_catalog.pg_roles where rolname = 'authenticated'),
  'browser roles cannot bypass RLS'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_events'::regclass)
  and (select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass),
  'audit and profile tables both enforce RLS'
);

select is(
  array(
    select attname::text from pg_catalog.pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
      and has_column_privilege('authenticated', attrelid, attnum, 'UPDATE')
    order by attname
  ),
  array['display_name', 'locale']::text[],
  'authenticated profile UPDATE grants cover exactly display_name and locale'
);

select ok(
  not has_table_privilege('authenticated', 'public.profiles', 'UPDATE'),
  'authenticated has no table-wide profile UPDATE grant'
);

select is(
  array(
    select attname::text from pg_catalog.pg_attribute
    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped
    order by attname
  ),
  array['created_at', 'display_name', 'locale', 'updated_at', 'user_id']::text[],
  'profiles has no authorization, organization, membership, role, or status columns'
);

-- Exact owner, security mode, fixed search_path, and complete EXECUTE ACL per function.

select ok(
  function_record.proowner = 'postgres'::regrole
  and function_record.prosecdef = expected.is_definer
  and function_record.proconfig = array['search_path=""']
  and (
    select array_agg(
      privilege.grantee::regrole::text || ':' || privilege.privilege_type
      || ':' || privilege.is_grantable::text || ':' || privilege.grantor::regrole::text
      order by privilege.grantee::regrole::text
    )
    from pg_catalog.aclexplode(
      coalesce(function_record.proacl, pg_catalog.acldefault('f', function_record.proowner))
    ) as privilege
  ) = case when expected.is_definer
    then array['authenticated:EXECUTE:false:postgres', 'postgres:EXECUTE:false:postgres']
    else array['postgres:EXECUTE:false:postgres']
  end,
  expected.signature || ' has exact owner, security, search_path, and EXECUTE grants'
)
from (values
  ('private.is_active_org_member(uuid)', true),
  ('private.has_org_role(uuid,text)', true),
  ('private.can_read_member_profile(uuid)', true),
  ('private.set_updated_at()', false),
  ('private.normalize_invitation_email()', false),
  ('private.reject_audit_event_mutation()', false)
) as expected(signature, is_definer)
join pg_catalog.pg_proc as function_record on function_record.oid = expected.signature::regprocedure;

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'CREATE')
  and not has_schema_privilege('anon', 'private', 'USAGE, CREATE')
  and not has_schema_privilege('service_role', 'private', 'USAGE, CREATE'),
  'private schema grants allow only authenticated helper lookup'
);

select is(
  (
    select count(*) from pg_catalog.pg_proc
    where pronamespace = 'public'::regnamespace and proname in (
      'is_active_org_member', 'has_org_role', 'can_read_member_profile',
      'set_updated_at', 'normalize_invitation_email', 'reject_audit_event_mutation'
    )
  ),
  0::bigint,
  'private functions have no same-name public Data API entry points'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.audit_events'::regclass and tgname = 'audit_events_reject_mutation'
      and tgfoid = 'private.reject_audit_event_mutation()'::regprocedure
      and tgtype = 27 and tgenabled = 'O' and not tgisinternal
  ),
  'audit rejection function is attached BEFORE UPDATE OR DELETE FOR EACH ROW'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.audit_events'::regclass and tgname = 'audit_events_reject_truncate'
      and tgfoid = 'private.reject_audit_event_mutation()'::regprocedure
      and tgtype = 34 and tgenabled = 'O' and not tgisinternal
  ),
  'audit rejection function is attached BEFORE TRUNCATE FOR EACH STATEMENT'
);

-- anon: assert actual database role and JWT identity, not only simulated metadata.
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select is(current_user::text, 'anon', 'anon runs under anon');

select is(auth.uid(), null::uuid, 'anon has no authenticated JWT subject');

select throws_ok('select * from public.audit_events', '42501', null, 'anon cannot SELECT audit events');

select throws_ok(statement.sql, '42501', null, 'anon cannot ' || statement.operation || ' audit_events')
from (values
  ('INSERT', $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('71000000-0000-4000-8000-000000000001', 'organization', '71000000-0000-4000-8000-000000000001', 'forged')$sql$),
  ('UPDATE', $sql$update public.audit_events set action = 'forged'$sql$),
  ('DELETE', $sql$delete from public.audit_events$sql$),
  ('TRUNCATE', $sql$truncate table public.audit_events$sql$)
) as statement(operation, sql);

select throws_ok(statement.sql, '42501', null, 'anon cannot directly execute private.' || statement.function_name)
from (values
  ('is_active_org_member', $sql$select private.is_active_org_member('71000000-0000-4000-8000-000000000001')$sql$),
  ('has_org_role', $sql$select private.has_org_role('71000000-0000-4000-8000-000000000001', 'manager')$sql$),
  ('can_read_member_profile', $sql$select private.can_read_member_profile('72000000-0000-4000-8000-000000000002')$sql$),
  ('set_updated_at', $sql$select private.set_updated_at()$sql$),
  ('normalize_invitation_email', $sql$select private.normalize_invitation_email()$sql$),
  ('reject_audit_event_mutation', $sql$select private.reject_audit_event_mutation()$sql$)
) as statement(function_name, sql);

-- employee: assert actual database role and JWT identity, not only simulated metadata.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"72000000-0000-4000-8000-000000000002","role":"authenticated"}';

select is(current_user::text, 'authenticated', 'employee runs under authenticated');

select is(auth.uid(), '72000000-0000-4000-8000-000000000002'::uuid, 'employee uses expected JWT subject');

select is((select count(*) from public.audit_events), 0::bigint, 'employee SELECT returns no audit events');

select throws_ok(statement.sql, '42501', null, 'employee cannot ' || statement.operation || ' audit_events')
from (values
  ('INSERT', $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('71000000-0000-4000-8000-000000000001', 'organization', '71000000-0000-4000-8000-000000000001', 'forged')$sql$),
  ('UPDATE', $sql$update public.audit_events set action = 'forged'$sql$),
  ('DELETE', $sql$delete from public.audit_events$sql$),
  ('TRUNCATE', $sql$truncate table public.audit_events$sql$)
) as statement(operation, sql);

select is(private.is_active_org_member('71000000-0000-4000-8000-000000000001'), true, 'employee helper recognizes own active membership');

select is(private.has_org_role('71000000-0000-4000-8000-000000000001', 'employee'), true, 'employee helper recognizes own employee role');

select is(private.has_org_role('71000000-0000-4000-8000-000000000001', 'manager'), false, 'employee helper cannot claim manager authority');

select is(private.is_active_org_member('71000000-0000-4000-8000-000000000002'), false, 'employee helper cannot inspect another tenant as a member');

select is(private.has_org_role('71000000-0000-4000-8000-000000000002', 'manager'), false, 'employee helper cannot disclose another tenant manager membership');

select is(private.can_read_member_profile('72000000-0000-4000-8000-000000000001'), false, 'employee profile helper denies coworker profile access');

select throws_ok(statement.sql, '42501', null, 'authenticated cannot directly execute private.' || statement.function_name)
from (values
  ('set_updated_at', $sql$select private.set_updated_at()$sql$),
  ('normalize_invitation_email', $sql$select private.normalize_invitation_email()$sql$),
  ('reject_audit_event_mutation', $sql$select private.reject_audit_event_mutation()$sql$)
) as statement(function_name, sql);

with changed as (
  update public.profiles
  set display_name = '{"role":"manager","status":"active","organization_id":"71000000-0000-4000-8000-000000000002"}',
      locale = 'nl-BE'
  where user_id = auth.uid()
  returning user_id, created_at, updated_at, display_name, locale
)
select ok(
  (
    select user_id = auth.uid() and created_at = '2000-01-01Z'::timestamptz
      and updated_at = statement_timestamp() and locale = 'nl-BE'
      and display_name = '{"role":"manager","status":"active","organization_id":"71000000-0000-4000-8000-000000000002"}'
    from changed
  ),
  'own allowed profile fields update while only trusted trigger sets updated_at'
);

select ok(
  (
    select organization_id = '71000000-0000-4000-8000-000000000001'
      and role = 'employee' and status = 'active'
    from public.memberships where user_id = auth.uid()
  )
  and not private.has_org_role('71000000-0000-4000-8000-000000000001', 'manager')
  and not private.is_active_org_member('71000000-0000-4000-8000-000000000002')
  and (select count(*) from public.audit_events) = 0,
  'role-like profile text changes no membership, organization, status, or authority'
);

select throws_ok(statement.sql, '42501', null, 'employee cannot directly update profile ' || statement.column_name)
from (values
  ('user_id', $sql$update public.profiles set user_id = '72000000-0000-4000-8000-000000000003' where user_id = auth.uid()$sql$),
  ('created_at', $sql$update public.profiles set created_at = now() where user_id = auth.uid()$sql$),
  ('updated_at', $sql$update public.profiles set updated_at = now() where user_id = auth.uid()$sql$)
) as statement(column_name, sql);

with changed as (
  update public.profiles set display_name = 'Forbidden employee change', locale = 'nl-BE'
  where user_id = '72000000-0000-4000-8000-000000000001'
  returning user_id
)
select is((select count(*) from changed), 0::bigint, 'employee cannot update another profile through RLS');

-- active manager: assert actual database role and JWT identity, not only simulated metadata.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"72000000-0000-4000-8000-000000000001","role":"authenticated"}';

select is(current_user::text, 'authenticated', 'active manager runs under authenticated');

select is(auth.uid(), '72000000-0000-4000-8000-000000000001'::uuid, 'active manager uses expected JWT subject');

select is(
  array(select organization_id from public.audit_events order by organization_id),
  array['71000000-0000-4000-8000-000000000001'::uuid],
  'active manager SELECT returns exactly own organization audit history'
);

select is(
  (select count(*) from public.audit_events where organization_id = '71000000-0000-4000-8000-000000000002'),
  0::bigint, 'active manager explicit cross-organization audit SELECT returns no rows'
);

select throws_ok(statement.sql, '42501', null, 'active manager cannot ' || statement.operation || ' audit_events')
from (values
  ('INSERT', $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('71000000-0000-4000-8000-000000000001', 'organization', '71000000-0000-4000-8000-000000000001', 'forged')$sql$),
  ('UPDATE', $sql$update public.audit_events set action = 'forged'$sql$),
  ('DELETE', $sql$delete from public.audit_events$sql$),
  ('TRUNCATE', $sql$truncate table public.audit_events$sql$)
) as statement(operation, sql);

select is(private.is_active_org_member('71000000-0000-4000-8000-000000000001'), true, 'manager helper recognizes own active membership');

select is(private.has_org_role('71000000-0000-4000-8000-000000000001', 'manager'), true, 'manager helper recognizes own manager role');

select is(private.is_active_org_member('71000000-0000-4000-8000-000000000002'), false, 'manager helper denies another organization membership');

select is(private.has_org_role('71000000-0000-4000-8000-000000000002', 'manager'), false, 'manager helper does not disclose another manager authority');

select is(private.can_read_member_profile('72000000-0000-4000-8000-000000000002'), true, 'manager profile helper allows authorized member profile');

select is(private.can_read_member_profile('72000000-0000-4000-8000-000000000003'), false, 'manager profile helper denies unrelated tenant profile');

select is(
  (select count(*) from public.profiles where user_id = '72000000-0000-4000-8000-000000000002'),
  1::bigint, 'manager SELECT can see employee profile before denied UPDATE'
);

with changed as (
  update public.profiles set display_name = 'Forbidden manager change', locale = 'nl-BE'
  where user_id = '72000000-0000-4000-8000-000000000002'
  returning user_id
)
select is((select count(*) from changed), 0::bigint, 'manager cannot update another profile despite SELECT permission');

-- inactive manager: assert actual database role and JWT identity, not only simulated metadata.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"72000000-0000-4000-8000-000000000004","role":"authenticated"}';

select is(current_user::text, 'authenticated', 'inactive manager runs under authenticated');

select is(auth.uid(), '72000000-0000-4000-8000-000000000004'::uuid, 'inactive manager uses expected JWT subject');

select is((select count(*) from public.audit_events), 0::bigint, 'inactive manager SELECT returns no audit events');

select is(private.is_active_org_member('71000000-0000-4000-8000-000000000001'), false, 'inactive manager membership helper returns false');

select is(private.has_org_role('71000000-0000-4000-8000-000000000001', 'manager'), false, 'inactive manager role helper returns false');

select is(private.can_read_member_profile('72000000-0000-4000-8000-000000000002'), false, 'inactive manager managed-profile helper returns false');

-- suspended-organization manager: assert actual database role and JWT identity, not only simulated metadata.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"72000000-0000-4000-8000-000000000005","role":"authenticated"}';

select is(current_user::text, 'authenticated', 'suspended-organization manager runs under authenticated');

select is(auth.uid(), '72000000-0000-4000-8000-000000000005'::uuid, 'suspended-organization manager uses expected JWT subject');

select is((select count(*) from public.audit_events), 0::bigint, 'suspended-organization manager SELECT returns no audit events');

select is(private.is_active_org_member('71000000-0000-4000-8000-000000000003'), false, 'suspended-organization manager membership helper returns false');

select is(private.has_org_role('71000000-0000-4000-8000-000000000003', 'manager'), false, 'suspended-organization manager role helper returns false');

select is(private.can_read_member_profile('72000000-0000-4000-8000-000000000005'), false, 'suspended-organization manager managed-profile helper returns false');

-- service role: assert actual database role and JWT identity, not only simulated metadata.
reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

select is(current_user::text, 'service_role', 'service role runs under service_role');

select is(auth.uid(), null::uuid, 'service role has no authenticated JWT subject');

select ok(
  (select rolbypassrls and not rolsuper from pg_catalog.pg_roles where rolname = current_user),
  'service_role intentionally has BYPASSRLS without superuser'
);

select is(
  array(select organization_id from public.audit_events order by organization_id),
  array[
    '71000000-0000-4000-8000-000000000001'::uuid,
    '71000000-0000-4000-8000-000000000002'::uuid,
    '71000000-0000-4000-8000-000000000003'::uuid
  ],
  'service role SELECT intentionally bypasses tenant and suspension policies'
);

select throws_ok(statement.sql, '42501', null, 'service role cannot ' || statement.operation || ' audit_events')
from (values
  ('INSERT', $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action) values ('71000000-0000-4000-8000-000000000001', 'organization', '71000000-0000-4000-8000-000000000001', 'forged')$sql$),
  ('UPDATE', $sql$update public.audit_events set action = 'forged'$sql$),
  ('DELETE', $sql$delete from public.audit_events$sql$),
  ('TRUNCATE', $sql$truncate table public.audit_events$sql$)
) as statement(operation, sql);

select throws_ok(statement.sql, '42501', null, 'service role cannot directly execute private.' || statement.function_name)
from (values
  ('is_active_org_member', $sql$select private.is_active_org_member('71000000-0000-4000-8000-000000000001')$sql$),
  ('has_org_role', $sql$select private.has_org_role('71000000-0000-4000-8000-000000000001', 'manager')$sql$),
  ('can_read_member_profile', $sql$select private.can_read_member_profile('72000000-0000-4000-8000-000000000002')$sql$),
  ('set_updated_at', $sql$select private.set_updated_at()$sql$),
  ('normalize_invitation_email', $sql$select private.normalize_invitation_email()$sql$),
  ('reject_audit_event_mutation', $sql$select private.reject_audit_event_mutation()$sql$)
) as statement(function_name, sql);

-- Owner bypasses RLS/table ACLs, so these exercise the triggers themselves.
reset role;

select is(current_user::text, 'postgres', 'owner trigger assertions run as postgres');

select throws_ok(
  $sql$update public.audit_events set action = 'owner_forged'$sql$,
  '55000', 'audit_events are append-only', 'owner UPDATE is rejected by audit trigger'
);

select throws_ok(
  'delete from public.audit_events',
  '55000', 'audit_events are append-only', 'owner DELETE is rejected by audit trigger'
);

select throws_ok(
  'truncate table public.audit_events',
  '55000', 'audit_events are append-only', 'owner TRUNCATE is rejected by statement trigger'
);

select is(
  (select count(*) from public.audit_events where action = 'synthetic_boundary_fixture'),
  3::bigint,
  'all audit fixtures survive browser, service, and owner mutation attempts'
);

select is(
  (select display_name from public.profiles where user_id = '72000000-0000-4000-8000-000000000001'),
  'Synthetic boundary profile',
  'denied employee profile update left manager unchanged'
);

select is(
  (select display_name from public.profiles where user_id = '72000000-0000-4000-8000-000000000002'),
  '{"role":"manager","status":"active","organization_id":"71000000-0000-4000-8000-000000000002"}',
  'denied manager profile update left employee permitted text unchanged'
);

select is(
  (
    select count(*) from public.memberships
    where organization_id = '71000000-0000-4000-8000-000000000001'
      and user_id = '72000000-0000-4000-8000-000000000002'
      and role = 'employee' and status = 'active'
  ),
  1::bigint,
  'profile changes left authoritative employee membership intact'
);

select * from finish();
rollback;
