begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(104);

-- Synthetic identities exist only for this transaction. No passwords or login flow.
insert into auth.users (
  id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data
)
values
  ('20000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'manager-a@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'employee-a@example.test', now(), '{"role":"manager"}', '{"role":"manager"}'),
  ('20000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'coworker-a@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000004', 'authenticated', 'authenticated', 'inactive-employee-a@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000005', 'authenticated', 'authenticated', 'inactive-manager-a@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000006', 'authenticated', 'authenticated', 'employee-b@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000007', 'authenticated', 'authenticated', 'manager-b@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000008', 'authenticated', 'authenticated', 'invited-a@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000009', 'authenticated', 'authenticated', 'no-membership@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000010', 'authenticated', 'authenticated', 'suspended-manager@example.test', now(), '{}', '{}'),
  ('20000000-0000-0000-0000-000000000011', 'authenticated', 'authenticated', 'suspended-employee@example.test', now(), '{}', '{}');

insert into public.profiles (user_id, display_name, created_at, updated_at)
values
  ('20000000-0000-0000-0000-000000000001', 'Manager A', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000002', 'Employee A', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000003', 'Coworker A', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000004', 'Inactive Employee A', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000005', 'Inactive Manager A', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000006', 'Employee B', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000007', 'Manager B', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000008', 'Invited A', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000009', 'No Membership', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000010', 'Suspended Manager', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  ('20000000-0000-0000-0000-000000000011', 'Suspended Employee', '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');

insert into public.organizations (id, name, lifecycle_status)
values
  ('10000000-0000-0000-0000-000000000001', 'Synthetic Organization A', 'research_pilot'),
  ('10000000-0000-0000-0000-000000000002', 'Synthetic Organization B', 'paid_beta'),
  ('10000000-0000-0000-0000-000000000003', 'Synthetic Suspended Organization', 'suspended');

insert into public.worksites (id, organization_id, name)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Synthetic Worksite A'),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Synthetic Worksite B'),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Synthetic Suspended Worksite');

insert into public.memberships (id, organization_id, user_id, role, status)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'manager', 'active'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'employee', 'active'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', 'employee', 'active'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000004', 'employee', 'inactive'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005', 'manager', 'inactive'),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000006', 'employee', 'active'),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000007', 'manager', 'active'),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000008', 'employee', 'invited'),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000010', 'manager', 'active'),
  ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000011', 'employee', 'active');

insert into public.invitations (
  id, organization_id, normalized_email, invited_by, expires_at
)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'invite-a@example.test', '20000000-0000-0000-0000-000000000001', now() + interval '1 day'),
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'invite-b@example.test', '20000000-0000-0000-0000-000000000007', now() + interval '1 day'),
  ('50000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'invite-suspended@example.test', '20000000-0000-0000-0000-000000000010', now() + interval '1 day');

insert into public.audit_events (
  id, organization_id, actor_user_id, entity_type, entity_id, action, after_data
)
values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'organization', '10000000-0000-0000-0000-000000000001', 'synthetic_fixture', '{"synthetic":true}'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000007', 'organization', '10000000-0000-0000-0000-000000000002', 'synthetic_fixture', '{"synthetic":true}'),
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000010', 'organization', '10000000-0000-0000-0000-000000000003', 'synthetic_fixture', '{"synthetic":true}'),
  ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', null, 'organization', '10000000-0000-0000-0000-000000000001', 'synthetic_system_fixture', '{"synthetic":true}');

-- Anonymous role has no application-table privileges, not even profile reads.
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';

select throws_ok('select * from public.profiles', '42501', null, 'anon cannot read profiles');
select throws_ok('select * from public.organizations', '42501', null, 'anon cannot read organizations');
select throws_ok('select * from public.worksites', '42501', null, 'anon cannot read worksites');
select throws_ok('select * from public.memberships', '42501', null, 'anon cannot read memberships');
select throws_ok('select * from public.invitations', '42501', null, 'anon cannot read invitations');
select throws_ok('select * from public.audit_events', '42501', null, 'anon cannot read audit events');
select throws_ok(
  $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action)
    values ('10000000-0000-0000-0000-000000000001', 'organization', '10000000-0000-0000-0000-000000000001', 'forged')$sql$,
  '42501', null, 'anon cannot insert arbitrary audit events'
);

-- Employee A carries misleading metadata. Only protected membership rows count.
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000002","role":"authenticated","user_metadata":{"role":"manager","organization_id":"10000000-0000-0000-0000-000000000002"},"app_metadata":{"role":"manager","organization_id":"10000000-0000-0000-0000-000000000002"}}';

select is(auth.uid(), '20000000-0000-0000-0000-000000000002'::uuid, 'employee test uses authenticated identity');
select is((select count(*)::integer from public.profiles where user_id = auth.uid()), 1, 'employee reads own profile');
select is((select count(*)::integer from public.profiles where user_id = '20000000-0000-0000-0000-000000000003'), 0, 'employee cannot read coworker profile');
select is((select count(*)::integer from public.profiles where user_id = '20000000-0000-0000-0000-000000000006'), 0, 'employee cannot read unrelated profile');
select is((select count(*)::integer from public.memberships where user_id = auth.uid()), 1, 'employee reads own active membership');
select is((select count(*)::integer from public.memberships), 1, 'employee cannot list coworkers');
select is((select count(*)::integer from public.organizations where id = '10000000-0000-0000-0000-000000000001'), 1, 'employee reads own organization');
select is((select count(*)::integer from public.organizations where id = '10000000-0000-0000-0000-000000000002'), 0, 'employee A cannot read organization B');
select is((select count(*)::integer from public.worksites where organization_id = '10000000-0000-0000-0000-000000000001'), 1, 'employee reads own worksite');
select is((select count(*)::integer from public.worksites where organization_id = '10000000-0000-0000-0000-000000000002'), 0, 'employee A cannot read worksite B');
select is((select count(*)::integer from public.invitations), 0, 'employee cannot read invitations');
select is((select count(*)::integer from public.audit_events), 0, 'employee cannot read organization audit history');
select is(private.has_org_role('10000000-0000-0000-0000-000000000001', 'manager'), false, 'metadata cannot promote employee to manager');
select is(private.is_active_org_member('10000000-0000-0000-0000-000000000002'), false, 'metadata cannot assign employee to another tenant');

select lives_ok(
  $sql$update public.profiles set display_name = 'Employee A Updated', locale = 'nl-BE'
    where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  'employee may update own permitted profile fields'
);
select is((select display_name from public.profiles where user_id = auth.uid()), 'Employee A Updated', 'own profile update persisted');
select ok((select updated_at > '2000-01-01T00:00:00Z'::timestamptz from public.profiles where user_id = auth.uid()), 'profile update refreshes updated_at');
with changed as (
  update public.profiles set display_name = 'Forbidden Change'
  where user_id = '20000000-0000-0000-0000-000000000003'
  returning user_id
)
select is((select count(*)::integer from changed), 0, 'employee cannot update coworker profile');
select throws_ok(
  $sql$update public.profiles set user_id = '20000000-0000-0000-0000-000000000009'
    where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  '42501', null, 'employee cannot replace profile identity'
);
select throws_ok(
  $sql$update public.profiles set created_at = now()
    where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  '42501', null, 'employee cannot rewrite profile created_at'
);
select throws_ok(
  $sql$update public.profiles set updated_at = now()
    where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  '42501', null, 'employee cannot directly set profile updated_at'
);
select throws_ok(
  $sql$insert into public.profiles (user_id, display_name)
    values ('20000000-0000-0000-0000-000000000002', 'Forbidden')$sql$,
  '42501', null, 'employee cannot insert a profile directly'
);
select throws_ok(
  $sql$delete from public.profiles where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  '42501', null, 'employee cannot delete a profile directly'
);
select throws_ok(
  $sql$insert into public.organizations (name, lifecycle_status) values ('Forbidden', 'research_pilot')$sql$,
  '42501', null, 'employee cannot create an organization'
);
select throws_ok(
  $sql$insert into public.worksites (organization_id, name)
    values ('10000000-0000-0000-0000-000000000001', 'Forbidden')$sql$,
  '42501', null, 'employee cannot create a worksite'
);
select throws_ok(
  $sql$update public.memberships set role = 'manager'
    where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  '42501', null, 'employee cannot change membership role'
);
select throws_ok(
  $sql$insert into public.invitations (organization_id, normalized_email, invited_by, expires_at)
    values ('10000000-0000-0000-0000-000000000001', 'forged@example.test', '20000000-0000-0000-0000-000000000002', now() + interval '1 day')$sql$,
  '42501', null, 'employee cannot create invitations'
);
select throws_ok(
  $sql$update public.invitations set status = 'accepted', accepted_by = '20000000-0000-0000-0000-000000000002', accepted_at = now()
    where id = '50000000-0000-0000-0000-000000000001'$sql$,
  '42501', null, 'employee cannot accept invitations directly'
);
select throws_ok(
  $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action)
    values ('10000000-0000-0000-0000-000000000001', 'organization', '10000000-0000-0000-0000-000000000001', 'forged')$sql$,
  '42501', null, 'employee cannot insert arbitrary audit events'
);
select throws_ok(
  $sql$update public.audit_events set action = 'forged'
    where id = '60000000-0000-0000-0000-000000000001'$sql$,
  '42501', null, 'employee cannot update audit events'
);
select throws_ok(
  $sql$delete from public.audit_events where id = '60000000-0000-0000-0000-000000000001'$sql$,
  '42501', null, 'employee cannot delete audit events'
);

-- Manager A sees all membership statuses in A, but no rows in B.
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';

select is((select count(*)::integer from public.memberships), 6, 'manager lists own organization memberships including invited and inactive');
select is((select count(*)::integer from public.memberships where organization_id = '10000000-0000-0000-0000-000000000002'), 0, 'manager A cannot list organization B memberships');
select is((select count(*)::integer from public.profiles), 6, 'manager reads profiles required for own organization members');
select is((select count(*)::integer from public.profiles where user_id = '20000000-0000-0000-0000-000000000006'), 0, 'manager cannot read unrelated organization profile');
select is((select count(*)::integer from public.organizations where id = '10000000-0000-0000-0000-000000000001'), 1, 'manager reads own organization');
select is((select count(*)::integer from public.organizations where id = '10000000-0000-0000-0000-000000000002'), 0, 'manager A cannot read organization B');
select is((select count(*)::integer from public.worksites where organization_id = '10000000-0000-0000-0000-000000000001'), 1, 'manager reads own worksite');
select is((select count(*)::integer from public.worksites where organization_id = '10000000-0000-0000-0000-000000000002'), 0, 'manager cannot read unrelated worksite');
select is((select count(*)::integer from public.invitations), 1, 'manager reads own organization invitations');
select is((select count(*)::integer from public.invitations where organization_id = '10000000-0000-0000-0000-000000000002'), 0, 'manager cannot read unrelated invitations');
select is((select count(*)::integer from public.audit_events), 2, 'manager reads own organization audit history including controlled system actor');
select is((select count(*)::integer from public.audit_events where organization_id = '10000000-0000-0000-0000-000000000002'), 0, 'manager cannot read unrelated audit history');
select throws_ok(
  $sql$update public.memberships set role = 'manager'
    where user_id = '20000000-0000-0000-0000-000000000002'$sql$,
  '42501', null, 'manager cannot directly promote employee'
);
select throws_ok(
  $sql$insert into public.memberships (organization_id, user_id, role, status)
    values ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'manager', 'active')$sql$,
  '42501', null, 'manager cannot add self to another organization'
);
select throws_ok(
  $sql$update public.memberships set status = 'active'
    where user_id = '20000000-0000-0000-0000-000000000004'$sql$,
  '42501', null, 'manager cannot directly change membership status'
);
select throws_ok(
  $sql$update public.memberships set organization_id = '10000000-0000-0000-0000-000000000002'
    where user_id = '20000000-0000-0000-0000-000000000003'$sql$,
  '42501', null, 'manager cannot reassign another person to another organization'
);
with changed as (
  update public.profiles set display_name = 'Forbidden Manager Change'
  where user_id = '20000000-0000-0000-0000-000000000003'
  returning user_id
)
select is((select count(*)::integer from changed), 0, 'manager cannot edit another member profile');
select throws_ok(
  $sql$insert into public.invitations (organization_id, normalized_email, intended_role, invited_by, expires_at)
    values ('10000000-0000-0000-0000-000000000001', 'forged-manager@example.test', 'manager', '20000000-0000-0000-0000-000000000001', now() + interval '1 day')$sql$,
  '42501', null, 'manager cannot create another manager invitation directly'
);
select throws_ok(
  $sql$update public.invitations set status = 'revoked', revoked_at = now()
    where id = '50000000-0000-0000-0000-000000000001'$sql$,
  '42501', null, 'manager cannot revoke invitation directly'
);
select throws_ok(
  $sql$insert into public.organizations (name, lifecycle_status) values ('Forbidden', 'research_pilot')$sql$,
  '42501', null, 'manager cannot create another organization'
);
select throws_ok(
  $sql$insert into public.worksites (organization_id, name)
    values ('10000000-0000-0000-0000-000000000001', 'Forbidden')$sql$,
  '42501', null, 'manager cannot create another worksite'
);
select throws_ok(
  $sql$insert into public.audit_events (organization_id, entity_type, entity_id, action)
    values ('10000000-0000-0000-0000-000000000001', 'organization', '10000000-0000-0000-0000-000000000001', 'forged')$sql$,
  '42501', null, 'manager cannot insert arbitrary audit events'
);
select throws_ok(
  $sql$update public.audit_events set action = 'forged'
    where id = '60000000-0000-0000-0000-000000000001'$sql$,
  '42501', null, 'manager cannot update audit events'
);
select throws_ok(
  $sql$delete from public.audit_events where id = '60000000-0000-0000-0000-000000000001'$sql$,
  '42501', null, 'manager cannot delete audit events'
);

-- Reverse tenant direction ensures A is not accidentally privileged globally.
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000006","role":"authenticated"}';
select is((select count(*)::integer from public.memberships), 1, 'employee B sees only own active membership');
select is((select count(*)::integer from public.organizations where id = '10000000-0000-0000-0000-000000000001'), 0, 'employee B cannot read organization A');
select is((select count(*)::integer from public.profiles where user_id = '20000000-0000-0000-0000-000000000001'), 0, 'employee B cannot read manager A profile');

set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000007","role":"authenticated"}';
select is((select count(*)::integer from public.memberships), 2, 'manager B lists only organization B memberships');
select is((select count(*)::integer from public.organizations where id = '10000000-0000-0000-0000-000000000001'), 0, 'manager B cannot read organization A');
select is((select count(*)::integer from public.invitations where organization_id = '10000000-0000-0000-0000-000000000001'), 0, 'manager B cannot read organization A invitations');
select is((select count(*)::integer from public.audit_events), 1, 'manager B sees only organization B audit history');

-- Authentication without an active membership grants no tenant access.
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000004","role":"authenticated"}';
select is((select count(*)::integer from public.profiles where user_id = auth.uid()), 1, 'inactive employee retains own profile');
select is((select count(*)::integer from public.organizations), 0, 'inactive employee cannot read organization');
select is((select count(*)::integer from public.worksites), 0, 'inactive employee cannot read worksite');
select is((select count(*)::integer from public.memberships), 0, 'inactive employee cannot read memberships');

set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000005","role":"authenticated"}';
select is((select count(*)::integer from public.profiles where user_id = auth.uid()), 1, 'inactive manager retains own profile');
select is((select count(*)::integer from public.organizations), 0, 'inactive manager cannot read organization');
select is((select count(*)::integer from public.worksites), 0, 'inactive manager cannot read worksite');
select is((select count(*)::integer from public.memberships), 0, 'inactive manager cannot list memberships');
select is((select count(*)::integer from public.invitations), 0, 'inactive manager cannot read invitations');
select is((select count(*)::integer from public.audit_events), 0, 'inactive manager cannot read audit events');
select is((select count(*)::integer from public.profiles where user_id = '20000000-0000-0000-0000-000000000003'), 0, 'inactive manager cannot read coworker profile');

set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000008","role":"authenticated"}';
select is((select count(*)::integer from public.organizations), 0, 'invited membership does not grant organization access');
select is((select count(*)::integer from public.memberships), 0, 'invited employee cannot read memberships');

set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000009","role":"authenticated"}';
select is((select count(*)::integer from public.organizations), 0, 'authentication alone does not grant organizations');
select is((select count(*)::integer from public.worksites), 0, 'authentication alone does not grant worksites');
select is((select count(*)::integer from public.memberships), 0, 'authentication alone does not grant memberships');
select is((select count(*)::integer from public.invitations), 0, 'authentication alone does not grant invitations');
select is((select count(*)::integer from public.audit_events), 0, 'authentication alone does not grant audit events');
select is((select count(*)::integer from public.profiles), 1, 'unaffiliated authenticated user reads only own profile');

-- Suspension blocks tenant rows even while memberships remain active.
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000010","role":"authenticated"}';
select is((select count(*)::integer from public.organizations), 0, 'suspended organization is inaccessible to manager');
select is((select count(*)::integer from public.worksites), 0, 'suspended worksite is inaccessible to manager');
select is((select count(*)::integer from public.memberships), 0, 'suspended manager cannot read even own active membership');
select is((select count(*)::integer from public.invitations), 0, 'suspended manager cannot read invitations');
select is((select count(*)::integer from public.audit_events), 0, 'suspended manager cannot read audit events');
select is((select count(*)::integer from public.profiles), 1, 'suspended manager reads only own profile');

set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000011","role":"authenticated"}';
select is(
  (select count(*)::integer from public.organizations)
  + (select count(*)::integer from public.worksites)
  + (select count(*)::integer from public.memberships),
  0, 'suspended employee cannot read tenant rows'
);
select is((select count(*)::integer from public.profiles), 1, 'suspended employee retains own profile');

-- Reuse the same authenticated claims before/after a privileged deactivation.
set local "request.jwt.claims" = '{"sub":"20000000-0000-0000-0000-000000000001","role":"authenticated"}';
reset role;
update public.memberships set status = 'inactive'
where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select is(
  (select count(*)::integer from public.organizations)
  + (select count(*)::integer from public.worksites)
  + (select count(*)::integer from public.memberships)
  + (select count(*)::integer from public.invitations)
  + (select count(*)::integer from public.audit_events),
  0, 'deactivation revokes all manager tenant reads without JWT refresh'
);
select is((select count(*)::integer from public.profiles), 1, 'deactivated manager sees only own profile');
reset role;
update public.memberships set status = 'active'
where id = '30000000-0000-0000-0000-000000000001';
set local role authenticated;
select is((select count(*)::integer from public.audit_events), 2, 'restored active membership restores only own tenant access');

-- Confirm denied writes did not silently alter protected data.
reset role;
select is((select role from public.memberships where id = '30000000-0000-0000-0000-000000000002'), 'employee', 'denied promotions left employee role unchanged');
select is((select count(*)::integer from public.memberships where organization_id = '10000000-0000-0000-0000-000000000002' and user_id = '20000000-0000-0000-0000-000000000001'), 0, 'denied cross-tenant membership insert left no row');
select is((select count(*)::integer from public.audit_events), 4, 'denied audit writes left all history intact');
select is((select display_name from public.profiles where user_id = '20000000-0000-0000-0000-000000000003'), 'Coworker A', 'denied profile updates left coworker unchanged');
select is((select status from public.invitations where id = '50000000-0000-0000-0000-000000000001'), 'pending', 'denied acceptance and revocation left invitation pending');

select * from finish();
rollback;
