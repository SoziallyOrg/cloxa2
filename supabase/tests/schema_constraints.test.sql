begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;

select plan(80);

-- Synthetic users have no passwords or usable sessions. Every fixture rolls back.
insert into auth.users (id, email) values
  ('51000000-0000-4000-8000-000000000001', 'schema.member@example.test'),
  ('51000000-0000-4000-8000-000000000002', 'schema.inviter@example.test'),
  ('51000000-0000-4000-8000-000000000003', 'schema.acceptor@example.test'),
  ('51000000-0000-4000-8000-000000000004', 'schema.actor@example.test'),
  ('51000000-0000-4000-8000-000000000005', 'schema.profile-only@example.test'),
  ('51000000-0000-4000-8000-000000000006', 'schema.other-member@example.test');

insert into public.profiles (user_id, display_name, updated_at) values
  ('51000000-0000-4000-8000-000000000001', 'Synthetic member', '2000-01-01Z'),
  ('51000000-0000-4000-8000-000000000005', 'Synthetic profile', '2000-01-01Z');

insert into public.organizations (id, name, lifecycle_status, updated_at) values
  ('52000000-0000-4000-8000-000000000001', 'Schema organization A', 'research_pilot', '2000-01-01Z'),
  ('52000000-0000-4000-8000-000000000002', 'Schema organization B', 'paid_beta', '2000-01-01Z'),
  ('52000000-0000-4000-8000-000000000003', 'Audit deletion fixture', 'research_pilot', '2000-01-01Z'),
  ('52000000-0000-4000-8000-000000000004', 'Worksite deletion fixture', 'research_pilot', '2000-01-01Z'),
  ('52000000-0000-4000-8000-000000000005', 'Membership deletion fixture', 'research_pilot', '2000-01-01Z'),
  ('52000000-0000-4000-8000-000000000006', 'Invitation deletion fixture', 'research_pilot', '2000-01-01Z');

insert into public.worksites (id, organization_id, name, updated_at) values
  ('53000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', 'Synthetic worksite', '2000-01-01Z'),
  ('53000000-0000-4000-8000-000000000004', '52000000-0000-4000-8000-000000000004', 'Deletion worksite', '2000-01-01Z');

insert into public.memberships (id, organization_id, user_id, role, status, updated_at) values
  ('54000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'employee', 'active', '2000-01-01Z'),
  ('54000000-0000-4000-8000-000000000005', '52000000-0000-4000-8000-000000000005', '51000000-0000-4000-8000-000000000006', 'employee', 'active', '2000-01-01Z');

insert into public.invitations (
  id, organization_id, normalized_email, invited_by, created_at, expires_at, updated_at
) values
  ('55000000-0000-4000-8000-000000000001', '52000000-0000-4000-8000-000000000001', '  Schema.Employee@Example.Test  ', '51000000-0000-4000-8000-000000000002', '2000-01-01Z', '2100-01-01Z', '2000-01-01Z'),
  ('55000000-0000-4000-8000-000000000002', '52000000-0000-4000-8000-000000000001', 'second@example.test', '51000000-0000-4000-8000-000000000002', '2000-01-01Z', '2100-01-01Z', '2000-01-01Z'),
  ('55000000-0000-4000-8000-000000000006', '52000000-0000-4000-8000-000000000006', 'deletion@example.test', '51000000-0000-4000-8000-000000000002', '2000-01-01Z', '2100-01-01Z', '2000-01-01Z');

insert into public.invitations (
  id, organization_id, normalized_email, invited_by, status,
  accepted_by, accepted_at, created_at, expires_at
) values (
  '55000000-0000-4000-8000-000000000007',
  '52000000-0000-4000-8000-000000000002', 'accepted@example.test',
  '51000000-0000-4000-8000-000000000002', 'accepted',
  '51000000-0000-4000-8000-000000000003', '2050-01-01Z',
  '2000-01-01Z', '2100-01-01Z'
);

insert into public.audit_events (
  id, organization_id, actor_user_id, entity_type, entity_id, action, after_data
) values (
  '56000000-0000-4000-8000-000000000001',
  '52000000-0000-4000-8000-000000000003',
  '51000000-0000-4000-8000-000000000004', 'organization',
  '52000000-0000-4000-8000-000000000003', 'synthetic_created',
  '{"synthetic": true}'::jsonb
);

-- 1-10: Every exposed application table is protected and uses expected key/time types.
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.profiles'::regclass), 'profiles has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.organizations'::regclass), 'organizations has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.worksites'::regclass), 'worksites has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.memberships'::regclass), 'memberships has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.invitations'::regclass), 'invitations has RLS enabled');
select ok((select relrowsecurity from pg_catalog.pg_class where oid = 'public.audit_events'::regclass), 'audit_events has RLS enabled');

select is(
  (
    select count(*)
    from pg_catalog.pg_attribute as attribute
    join pg_catalog.pg_attrdef as definition
      on definition.adrelid = attribute.attrelid and definition.adnum = attribute.attnum
    where attribute.attrelid in (
      'public.organizations'::regclass, 'public.worksites'::regclass,
      'public.memberships'::regclass, 'public.invitations'::regclass,
      'public.audit_events'::regclass
    )
      and attribute.attname = 'id'
      and attribute.atttypid = 'uuid'::regtype
      and pg_catalog.pg_get_expr(definition.adbin, definition.adrelid)
        ~ '(^|[.])gen_random_uuid[(][)]$'
  ),
  5::bigint,
  'all five independent UUID primary keys have Postgres generation defaults'
);

select col_type_is('public', 'profiles', 'user_id', 'uuid', 'profile identity uses auth user UUID');

select is(
  (
    select count(*)
    from pg_catalog.pg_constraint as constraint_record
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = constraint_record.conrelid
      and attribute.attnum = constraint_record.conkey[1]
    where constraint_record.conrelid in (
      'public.profiles'::regclass, 'public.organizations'::regclass,
      'public.worksites'::regclass, 'public.memberships'::regclass,
      'public.invitations'::regclass, 'public.audit_events'::regclass
    )
      and constraint_record.contype = 'p'
      and pg_catalog.cardinality(constraint_record.conkey) = 1
      and attribute.atttypid = 'uuid'::regtype
  ),
  6::bigint,
  'all six application tables have single-column UUID primary keys'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('profiles', 'organizations', 'worksites', 'memberships', 'invitations', 'audit_events')
      and column_name in ('created_at', 'updated_at', 'expires_at', 'accepted_at', 'revoked_at')
      and data_type = 'timestamp with time zone'
  ),
  14::bigint,
  'all fourteen application timestamps use timestamptz'
);

-- 11-15: Defaults and insert-time normalization.
select is((select locale from public.profiles where user_id = '51000000-0000-4000-8000-000000000001'), 'nl-BE', 'profile locale defaults to nl-BE');
select is((select timezone from public.worksites where id = '53000000-0000-4000-8000-000000000001'), 'Europe/Brussels', 'worksite timezone defaults to Europe/Brussels');
select is((select intended_role from public.invitations where id = '55000000-0000-4000-8000-000000000001'), 'employee', 'invitation role defaults to employee');
select is((select status from public.invitations where id = '55000000-0000-4000-8000-000000000001'), 'pending', 'invitation status defaults to pending');
select is((select normalized_email from public.invitations where id = '55000000-0000-4000-8000-000000000001'), 'schema.employee@example.test', 'invitation insert trims and lowercases email');

-- 16-29: Uniqueness and constrained values cannot be bypassed by trusted writes.
select throws_ok(
  $$insert into public.memberships (organization_id, user_id, role, status)
    values ('52000000-0000-4000-8000-000000000001', '51000000-0000-4000-8000-000000000001', 'manager', 'inactive')$$,
  '23505', null, 'duplicate organization/user memberships are rejected regardless of role/status'
);

select throws_ok(
  $$update public.memberships set role = 'owner' where id = '54000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'unrecognized membership role is rejected'
);

select throws_ok(
  $$update public.memberships set status = 'blocked' where id = '54000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'unrecognized membership status is rejected'
);

select throws_ok(
  $$update public.memberships set employee_code = '   ' where id = '54000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'blank employee code is rejected'
);

select throws_ok(
  $$update public.organizations set lifecycle_status = 'trial' where id = '52000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'unrecognized organization lifecycle is rejected'
);

select throws_ok(
  $$update public.organizations set name = '  ' where id = '52000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'blank organization name is rejected'
);

select throws_ok(
  $$update public.profiles set locale = 'invalid-locale' where user_id = '51000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'unsupported profile locale is rejected'
);

select throws_ok(
  $$update public.profiles set display_name = '  ' where user_id = '51000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'blank display name is rejected'
);

select throws_ok(
  $$update public.worksites set name = '  ' where id = '53000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'blank worksite name is rejected'
);

select throws_ok(
  $$update public.worksites set timezone = '  ' where id = '53000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'blank worksite timezone is rejected'
);

select throws_ok(
  $$update public.invitations set intended_role = 'manager' where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'normal invitations cannot create managers'
);

select throws_ok(
  $$update public.invitations set status = 'sent' where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'unrecognized invitation status is rejected'
);

select throws_ok(
  $$update public.invitations set normalized_email = '  ' where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'blank invitation email is rejected after normalization'
);

select throws_ok(
  $$update public.invitations set expires_at = created_at where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'invitation expiry must follow creation'
);

-- 30-43: Declarative invitation-state coherence, not an acceptance workflow.
select throws_ok(
  $$update public.invitations set status = 'accepted', accepted_at = '2050-01-01Z'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'accepted invitation requires accepting user'
);

select throws_ok(
  $$update public.invitations set status = 'accepted', accepted_by = '51000000-0000-4000-8000-000000000003'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'accepted invitation requires acceptance timestamp'
);

select throws_ok(
  $$update public.invitations set revoked_at = '2050-01-01Z'
    where id = '55000000-0000-4000-8000-000000000007'$$,
  '23514', null, 'accepted invitation cannot also be revoked'
);

select throws_ok(
  $$update public.invitations set accepted_at = created_at - interval '1 microsecond'
    where id = '55000000-0000-4000-8000-000000000007'$$,
  '23514', null, 'acceptance before creation is rejected'
);

select throws_ok(
  $$update public.invitations set accepted_at = expires_at
    where id = '55000000-0000-4000-8000-000000000007'$$,
  '23514', null, 'acceptance at expiry boundary is rejected'
);

select throws_ok(
  $$update public.invitations set accepted_by = '51000000-0000-4000-8000-000000000003'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'pending invitation cannot have accepting user'
);

select throws_ok(
  $$update public.invitations set accepted_at = '2050-01-01Z'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'pending invitation cannot have acceptance timestamp'
);

select throws_ok(
  $$update public.invitations set revoked_at = '2050-01-01Z'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'pending invitation cannot have revocation timestamp'
);

select throws_ok(
  $$update public.invitations set status = 'expired', accepted_by = '51000000-0000-4000-8000-000000000003'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'expired invitation cannot have accepting user'
);

select throws_ok(
  $$update public.invitations set status = 'expired', revoked_at = '2050-01-01Z'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'expired invitation cannot have revocation timestamp'
);

select throws_ok(
  $$update public.invitations set status = 'revoked'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'revoked invitation requires revocation timestamp'
);

select throws_ok(
  $$update public.invitations set status = 'revoked', revoked_at = '2050-01-01Z',
      accepted_by = '51000000-0000-4000-8000-000000000003'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'revoked invitation cannot have accepting user'
);

select throws_ok(
  $$update public.invitations set status = 'revoked', revoked_at = '2050-01-01Z', accepted_at = '2050-01-01Z'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'revoked invitation cannot have acceptance timestamp'
);

select throws_ok(
  $$update public.invitations set status = 'revoked', revoked_at = created_at - interval '1 microsecond'
    where id = '55000000-0000-4000-8000-000000000001'$$,
  '23514', null, 'revocation before creation is rejected'
);

-- 44-50: One canonical email per pending invitation in each organization.
select throws_ok(
  $$insert into public.invitations (organization_id, normalized_email, invited_by, expires_at)
    values ('52000000-0000-4000-8000-000000000001', ' SCHEMA.EMPLOYEE@EXAMPLE.TEST ',
      '51000000-0000-4000-8000-000000000002', now() + interval '1 day')$$,
  '23505', null, 'equivalent pending email in same organization is rejected'
);

select lives_ok(
  $$insert into public.invitations (organization_id, normalized_email, invited_by, expires_at)
    values ('52000000-0000-4000-8000-000000000002', ' SCHEMA.EMPLOYEE@EXAMPLE.TEST ',
      '51000000-0000-4000-8000-000000000002', now() + interval '1 day')$$,
  'same pending email can belong to different organizations'
);

with changed as (
  update public.invitations set normalized_email = ' Changed.Email@Example.Test '
  where id = '55000000-0000-4000-8000-000000000002'
  returning normalized_email
)
select is((select normalized_email from changed), 'changed.email@example.test', 'invitation email updates also trim and lowercase');

select throws_ok(
  $$update public.invitations set normalized_email = ' SCHEMA.EMPLOYEE@EXAMPLE.TEST '
    where id = '55000000-0000-4000-8000-000000000002'$$,
  '23505', null, 'email update cannot create equivalent pending duplicate'
);

select lives_ok(
  $$insert into public.invitations (
      organization_id, normalized_email, invited_by, status, created_at, expires_at
    ) values
      ('52000000-0000-4000-8000-000000000001', 'expired-reinvite@example.test', '51000000-0000-4000-8000-000000000002', 'expired', '2000-01-01Z', '2001-01-01Z'),
      ('52000000-0000-4000-8000-000000000001', ' EXPIRED-REINVITE@EXAMPLE.TEST ', '51000000-0000-4000-8000-000000000002', 'pending', now(), now() + interval '1 day')$$,
  'expired invitation permits new pending invitation for same email'
);

select lives_ok(
  $$insert into public.invitations (
      organization_id, normalized_email, invited_by, status, created_at, expires_at, accepted_by, accepted_at
    ) values
      ('52000000-0000-4000-8000-000000000001', 'accepted-reinvite@example.test', '51000000-0000-4000-8000-000000000002', 'accepted', '2000-01-01Z', '2001-01-01Z', '51000000-0000-4000-8000-000000000003', '2000-06-01Z'),
      ('52000000-0000-4000-8000-000000000001', ' ACCEPTED-REINVITE@EXAMPLE.TEST ', '51000000-0000-4000-8000-000000000002', 'pending', now(), now() + interval '1 day', null, null)$$,
  'accepted invitation permits new pending invitation for same email'
);

select lives_ok(
  $$insert into public.invitations (
      organization_id, normalized_email, invited_by, status, created_at, expires_at, revoked_at
    ) values
      ('52000000-0000-4000-8000-000000000001', 'revoked-reinvite@example.test', '51000000-0000-4000-8000-000000000002', 'revoked', '2000-01-01Z', '2001-01-01Z', '2000-06-01Z'),
      ('52000000-0000-4000-8000-000000000001', ' REVOKED-REINVITE@EXAMPLE.TEST ', '51000000-0000-4000-8000-000000000002', 'pending', now(), now() + interval '1 day', null)$$,
  'revoked invitation permits new pending invitation for same email'
);

-- 51-60: Independent fixtures distinguish each foreign-key deletion policy.
select throws_ok(
  $$delete from public.organizations where id = '52000000-0000-4000-8000-000000000005'$$,
  '23503', null, 'membership prevents accidental organization deletion'
);

select throws_ok(
  $$delete from public.organizations where id = '52000000-0000-4000-8000-000000000004'$$,
  '23503', null, 'worksite prevents accidental organization deletion'
);

select throws_ok(
  $$delete from public.organizations where id = '52000000-0000-4000-8000-000000000006'$$,
  '23503', null, 'invitation prevents accidental organization deletion'
);

select throws_ok(
  $$delete from public.organizations where id = '52000000-0000-4000-8000-000000000003'$$,
  '23503', null, 'audit history prevents organization deletion instead of cascading'
);

select throws_ok(
  $$delete from auth.users where id = '51000000-0000-4000-8000-000000000006'$$,
  '23503', null, 'membership preserves referenced auth user'
);

select throws_ok(
  $$delete from auth.users where id = '51000000-0000-4000-8000-000000000002'$$,
  '23503', null, 'invitation preserves inviting auth user'
);

select throws_ok(
  $$delete from auth.users where id = '51000000-0000-4000-8000-000000000003'$$,
  '23503', null, 'accepted invitation preserves accepting auth user'
);

select throws_ok(
  $$delete from auth.users where id = '51000000-0000-4000-8000-000000000004'$$,
  '23503', null, 'audit history preserves referenced actor'
);

select lives_ok(
  $$delete from auth.users where id = '51000000-0000-4000-8000-000000000005'$$,
  'profile-only auth user can be deleted'
);

select is(
  (select count(*) from public.profiles where user_id = '51000000-0000-4000-8000-000000000005'),
  0::bigint, 'profile cascades with its deleted auth user'
);

-- 61-69: Audit events reject even owner mutations; ordinary records refresh timestamps.
select throws_ok(
  $$update public.audit_events set action = 'tampered' where id = '56000000-0000-4000-8000-000000000001'$$,
  '55000', 'audit_events are append-only', 'owner UPDATE cannot rewrite audit event'
);

select throws_ok(
  $$delete from public.audit_events where id = '56000000-0000-4000-8000-000000000001'$$,
  '55000', 'audit_events are append-only', 'owner DELETE cannot remove audit event'
);

select is(
  (select count(*) from public.audit_events where id = '56000000-0000-4000-8000-000000000001' and action = 'synthetic_created' and after_data = '{"synthetic": true}'::jsonb),
  1::bigint, 'audit event remains unchanged after rejected deletions and mutations'
);

with changed as (
  update public.profiles set display_name = 'Updated synthetic member', updated_at = '1999-01-01Z'
  where user_id = '51000000-0000-4000-8000-000000000001' returning updated_at
)
select is((select updated_at from changed), statement_timestamp(), 'profile update refreshes updated_at instead of accepting forged timestamp');

with changed as (
  update public.organizations set name = 'Updated schema organization A', updated_at = '1999-01-01Z'
  where id = '52000000-0000-4000-8000-000000000001' returning updated_at
)
select is((select updated_at from changed), statement_timestamp(), 'organization update refreshes updated_at');

with changed as (
  update public.worksites set name = 'Updated synthetic worksite', updated_at = '1999-01-01Z'
  where id = '53000000-0000-4000-8000-000000000001' returning updated_at
)
select is((select updated_at from changed), statement_timestamp(), 'worksite update refreshes updated_at');

with changed as (
  update public.memberships set employee_code = 'SYN-001', updated_at = '1999-01-01Z'
  where id = '54000000-0000-4000-8000-000000000001' returning updated_at
)
select is((select updated_at from changed), statement_timestamp(), 'membership update refreshes updated_at');

with changed as (
  update public.invitations set expires_at = '2101-01-01Z', updated_at = '1999-01-01Z'
  where id = '55000000-0000-4000-8000-000000000001' returning updated_at
)
select is((select updated_at from changed), statement_timestamp(), 'invitation update refreshes updated_at');

select lives_ok(
  $$insert into public.audit_events (organization_id, actor_user_id, entity_type, entity_id, action)
    values ('52000000-0000-4000-8000-000000000003', null, 'organization',
      '52000000-0000-4000-8000-000000000003', 'synthetic_system_action')$$,
  'trusted system audit event may have null actor'
);

-- 70-80: Privileged functions stay private and audit privileges stay append-only.
select is(
  (select count(*) from pg_catalog.pg_proc where pronamespace = 'private'::regnamespace and proname in ('is_active_org_member', 'has_org_role', 'can_read_member_profile') and prosecdef),
  3::bigint, 'all three membership-query helpers use SECURITY DEFINER to avoid RLS recursion'
);

select is(
  (select count(*) from pg_catalog.pg_proc where pronamespace = 'private'::regnamespace and proname in ('set_updated_at', 'normalize_invitation_email', 'reject_audit_event_mutation') and not prosecdef),
  3::bigint, 'trigger functions do not unnecessarily use SECURITY DEFINER'
);

select is(
  (select count(*) from pg_catalog.pg_proc where pronamespace = 'private'::regnamespace and proname in ('is_active_org_member', 'has_org_role', 'can_read_member_profile', 'set_updated_at', 'normalize_invitation_email', 'reject_audit_event_mutation') and proconfig @> array['search_path=""']),
  6::bigint, 'all six private functions have fixed empty search_path'
);

select ok(
  has_schema_privilege('authenticated', 'private', 'USAGE')
  and not has_schema_privilege('authenticated', 'private', 'CREATE')
  and has_function_privilege('authenticated', 'private.is_active_org_member(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.has_org_role(uuid,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'private.can_read_member_profile(uuid)', 'EXECUTE'),
  'authenticated can execute only required authorization helpers without creating private objects'
);

select ok(
  not has_schema_privilege('anon', 'private', 'USAGE, CREATE')
  and not exists (
    select 1 from pg_catalog.pg_proc
    where pronamespace = 'private'::regnamespace and has_function_privilege('anon', oid, 'EXECUTE')
  ),
  'anon cannot access private schema or execute its functions'
);

select ok(
  not has_schema_privilege('service_role', 'private', 'USAGE, CREATE')
  and not exists (
    select 1 from pg_catalog.pg_proc
    where pronamespace = 'private'::regnamespace and has_function_privilege('service_role', oid, 'EXECUTE')
  ),
  'service_role has no unnecessary private schema or function privileges'
);

select ok(
  not exists (
    select 1 from pg_catalog.pg_proc as function_record
    cross join lateral pg_catalog.aclexplode(
      coalesce(function_record.proacl, pg_catalog.acldefault('f', function_record.proowner))
    ) as privilege
    where function_record.pronamespace = 'private'::regnamespace
      and privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
  ),
  'PUBLIC has no execution grants on private functions'
);

select ok(
  not has_function_privilege('authenticated', 'private.set_updated_at()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.normalize_invitation_email()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'private.reject_audit_event_mutation()', 'EXECUTE'),
  'authenticated cannot directly execute trigger functions'
);

select ok(
  not has_table_privilege('anon', 'public.audit_events', 'TRUNCATE')
  and not has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE')
  and not has_table_privilege('service_role', 'public.audit_events', 'TRUNCATE'),
  'browser and service roles cannot truncate audit history'
);

select ok(
  not has_table_privilege('anon', 'public.audit_events', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.audit_events', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('service_role', 'public.audit_events', 'INSERT, UPDATE, DELETE'),
  'browser and service roles cannot insert arbitrary events or mutate audit history'
);

select is(
  (select count(*) from pg_catalog.pg_constraint where conrelid = 'public.audit_events'::regclass and contype = 'f' and confdeltype = 'r'),
  2::bigint, 'both audit foreign keys explicitly restrict deletion'
);

select * from finish();
rollback;
