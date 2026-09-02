begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';
select plan(129);

-- Synthetic, transaction-only Auth rows and sessions. Password markers are not
-- hashes and cannot be used to sign in; no email is sent by this SQL suite.
with fixtures(number, email) as (values
  (1, 'invite.manager-a@example.test'),
  (2, 'invite.employee-a@example.test'),
  (3, 'invite.manager-b@example.test'),
  (4, 'invite.inactive-manager@example.test'),
  (5, 'invite.suspended-manager@example.test'),
  (6, 'invite.new-employee@example.test'),
  (7, 'invite.wrong-email@example.test'),
  (8, 'invite.unverified@example.test'),
  (9, 'invite.passwordless@example.test'),
  (10, 'invite.revoked@example.test'),
  (11, 'invite.expired@example.test'),
  (12, 'invite.invited-member@example.test'),
  (13, 'invite.inactive-member@example.test'),
  (14, 'invite.dormant-manager@example.test'),
  (15, 'invite.ambiguous@example.test'),
  (16, 'invite.multi-manager@example.test'),
  (17, 'invite.banned@example.test'),
  (18, 'invite.deleted@example.test'),
  (19, 'invite.sessionless@example.test'),
  (20, 'invite.expired-session@example.test'),
  (21, 'invite.unaffiliated@example.test'),
  (22, 'invite.existing-profile@example.test'),
  (23, 'invite.suspended-target@example.test')
)
insert into auth.users (
  id, email, email_confirmed_at, encrypted_password, banned_until, deleted_at,
  raw_user_meta_data
)
select ('81000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  email,
  case when number = 8 then null else now() - interval '1 day' end,
  case when number = 9 then '' else 'transaction-only-not-a-password-hash' end,
  case when number = 17 then now() + interval '1 day' else null end,
  case when number = 18 then now() - interval '1 hour' else null end,
  '{"role":"manager","status":"active","organization_id":"83000000-0000-4000-8000-000000000002"}'::jsonb
from fixtures;

insert into auth.sessions (id, user_id, created_at, updated_at, not_after)
select ('82000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  ('81000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  now(), now(), case when number = 20 then now() - interval '1 hour' else null end
from generate_series(1, 23) as numbers(number)
where number <> 19;

insert into public.organizations (id, name, lifecycle_status) values
  ('83000000-0000-4000-8000-000000000001', 'Invitation organization A', 'research_pilot'),
  ('83000000-0000-4000-8000-000000000002', 'Invitation organization B', 'paid_beta'),
  ('83000000-0000-4000-8000-000000000003', 'Invitation suspended organization', 'suspended');

with fixtures(number, organization_number, role, status) as (values
  (1, 1, 'manager', 'active'), (2, 1, 'employee', 'active'),
  (3, 2, 'manager', 'active'), (4, 1, 'manager', 'inactive'),
  (5, 3, 'manager', 'active'), (12, 1, 'employee', 'invited'),
  (13, 1, 'employee', 'inactive'), (14, 1, 'manager', 'inactive'),
  (16, 1, 'manager', 'active'), (17, 1, 'manager', 'active'),
  (18, 1, 'manager', 'active'), (19, 1, 'manager', 'active'),
  (20, 1, 'manager', 'active')
)
insert into public.memberships (id, organization_id, user_id, role, status)
select ('84000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  ('83000000-0000-4000-8000-' || lpad(organization_number::text, 12, '0'))::uuid,
  ('81000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  role, status from fixtures;
insert into public.memberships (organization_id, user_id, role, status) values
  ('83000000-0000-4000-8000-000000000003', '81000000-0000-4000-8000-000000000016', 'employee', 'active');
insert into public.profiles (user_id, display_name) values
  ('81000000-0000-4000-8000-000000000022', 'Bestaande profielnaam');

insert into public.invitations (
  id, organization_id, normalized_email, invited_by, created_at, expires_at,
  status, revoked_at, display_name, employee_code
)
select ('85000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid,
  case when number = 23 then '83000000-0000-4000-8000-000000000003'::uuid
    else '83000000-0000-4000-8000-000000000001'::uuid end,
  auth_user.email, '81000000-0000-4000-8000-000000000001',
  now() - interval '2 days',
  case when number = 11 then now() - interval '1 hour' else now() + interval '1 day' end,
  case when number = 10 then 'revoked' else 'pending' end,
  case when number = 10 then now() - interval '1 day' else null end,
  'Fictieve medewerker', 'TEST-EMP'
from generate_series(8, 23) as numbers(number)
join auth.users as auth_user
  on auth_user.id = ('81000000-0000-4000-8000-' || lpad(number::text, 12, '0'))::uuid
where number in (8, 9, 10, 11, 12, 13, 14, 15, 22, 23);

insert into public.invitations (
  organization_id, normalized_email, invited_by, created_at, expires_at
) values
  ('83000000-0000-4000-8000-000000000002', 'invite.ambiguous@example.test',
    '81000000-0000-4000-8000-000000000003', now(), now() + interval '1 day'),
  ('83000000-0000-4000-8000-000000000001', 'invite.mismatch-target@example.test',
    '81000000-0000-4000-8000-000000000001', now(), now() + interval '1 day'),
  ('83000000-0000-4000-8000-000000000002', 'invite.employee-a@example.test',
    '81000000-0000-4000-8000-000000000003', now(), now() + interval '1 day'),
  ('83000000-0000-4000-8000-000000000001', 'invite.stale@example.test',
    '81000000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '1 day');

-- Exact security modes, fixed paths, owners, and complete function ACLs.
select ok(
  function_record.proowner = 'postgres'::regrole
  and function_record.prosecdef = expected.is_definer
  and function_record.proconfig = array['search_path=""']
  and (
    select array_agg(
      privilege.grantee::regrole::text || ':' || privilege.privilege_type
      || ':' || privilege.is_grantable::text || ':' || privilege.grantor::regrole::text
      order by privilege.grantee::regrole::text
    ) from pg_catalog.aclexplode(
      coalesce(function_record.proacl, pg_catalog.acldefault('f', function_record.proowner))
    ) as privilege
  ) = array['authenticated:EXECUTE:false:postgres', 'postgres:EXECUTE:false:postgres'],
  expected.signature || ' has exact least-privilege security configuration'
)
from (values
  ('private.get_auth_context()', true),
  ('private.create_employee_invitation(text,text,text)', true),
  ('private.get_employee_invitation_state()', true),
  ('private.accept_employee_invitation()', true),
  ('public.get_auth_context()', false),
  ('public.create_employee_invitation(text,text,text)', false),
  ('public.get_employee_invitation_state()', false),
  ('public.accept_employee_invitation()', false)
) as expected(signature, is_definer)
join pg_catalog.pg_proc as function_record on function_record.oid = expected.signature::regprocedure;

select is(
  (select proargnames from pg_catalog.pg_proc
   where oid = 'public.create_employee_invitation(text,text,text)'::regprocedure),
  array['employee_email', 'display_name', 'employee_code']::text[],
  'creation accepts no organization, role, status, user, worksite, or expiry inputs'
);
select is(
  (select pronargs::integer from pg_catalog.pg_proc
   where oid = 'public.accept_employee_invitation()'::regprocedure),
  0, 'acceptance accepts no browser-controlled invitation or authorization inputs'
);
select ok(
  not exists (select 1 from pg_catalog.pg_proc
    where pronamespace = 'public'::regnamespace and prosecdef),
  'no SECURITY DEFINER function is in the exposed public schema'
);
select ok(
  not has_table_privilege('authenticated', 'public.invitations', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.memberships', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('authenticated', 'public.audit_events', 'INSERT, UPDATE, DELETE')
  and not has_table_privilege('service_role', 'public.audit_events', 'INSERT, UPDATE, DELETE'),
  'controlled RPCs add no broad protected-table or audit write grants'
);

set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(statement.sql, '42501', null, 'anon cannot ' || statement.operation)
from (values
  ('create invitation', $$select public.create_employee_invitation('anon@example.test')$$),
  ('accept invitation', $$select public.accept_employee_invitation()$$),
  ('preflight invitation', $$select public.get_employee_invitation_state()$$),
  ('read auth context', $$select * from public.get_auth_context()$$)
) as statement(operation, sql);

reset role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(statement.sql, '42501', null, 'service role cannot ' || statement.operation)
from (values
  ('create invitation as arbitrary actor', $$select public.create_employee_invitation('service@example.test')$$),
  ('accept invitation as arbitrary actor', $$select public.accept_employee_invitation()$$)
) as statement(operation, sql);

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated"}';
select throws_ok(
  $$select public.create_employee_invitation('no-sub@example.test')$$,
  '42501', 'Uitnodiging kan niet worden verwerkt.', 'authenticated role without subject cannot invite'
);
select is((select authorization_state from public.get_auth_context()), 'unauthorized',
  'authenticated role without subject has no tenant context');

-- Protected mutations reject invalid caller states despite forged user metadata.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000002',
  'session_id', '82000000-0000-4000-8000-000000000002',
  'user_metadata', jsonb_build_object('role', 'manager', 'status', 'active')
)::text, true);
select throws_ok(
  $$select public.create_employee_invitation('employee-forged@example.test')$$,
  '42501', 'Uitnodiging kan niet worden verwerkt.', 'employee metadata cannot grant invitation authority'
);
select is((select membership_role from public.get_auth_context()), 'employee',
  'membership role wins over editable manager metadata');
select is(public.get_employee_invitation_state(), 'unavailable',
  'active employee cannot preflight a second tenant invitation');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'active membership prevents second tenant acceptance');
select is((select count(*) from public.memberships where user_id = auth.uid()), 1::bigint,
  'denied second tenant acceptance preserves exactly one active employee membership');

select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000004',
  'session_id', '82000000-0000-4000-8000-000000000004'
)::text, true);
select throws_ok($$select public.create_employee_invitation('inactive-forged@example.test')$$,
  '42501', null, 'inactive manager cannot invite');
select is((select authorization_state from public.get_auth_context()), 'unauthorized',
  'inactive manager has no route authorization');

select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000005',
  'session_id', '82000000-0000-4000-8000-000000000005'
)::text, true);
select throws_ok($$select public.create_employee_invitation('suspended-forged@example.test')$$,
  '42501', null, 'suspended-organization manager cannot invite');
select is((select authorization_state from public.get_auth_context()), 'unauthorized',
  'suspended organization has no route authorization');

select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000016',
  'session_id', '82000000-0000-4000-8000-000000000016'
)::text, true);
select throws_ok($$select public.create_employee_invitation('multi-forged@example.test')$$,
  '42501', null, 'multiple active memberships prevent invitation creation');
select is((select authorization_state from public.get_auth_context()), 'unsupported',
  'active membership in suspended tenant still counts toward unsupported multi-tenant state');
select ok((select organization_id is null and membership_role is null from public.get_auth_context()),
  'unsupported state selects no organization or role');

-- Distinct JWT session IDs prove live-session/user checks, not only role checks.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000017',
  'session_id', '82000000-0000-4000-8000-000000000017'
)::text, true);
select throws_ok($$select public.create_employee_invitation('banned-forged@example.test')$$,
  '42501', null, 'banned manager cannot invite with a previously issued JWT');
select is((select authorization_state from public.get_auth_context()), 'unauthorized', 'banned user cannot use role routes');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000018',
  'session_id', '82000000-0000-4000-8000-000000000018'
)::text, true);
select throws_ok($$select public.create_employee_invitation('deleted-forged@example.test')$$,
  '42501', null, 'deleted manager cannot invite with a previously issued JWT');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000019',
  'session_id', '82000000-0000-4000-8000-000000000019'
)::text, true);
select throws_ok($$select public.create_employee_invitation('sessionless-forged@example.test')$$,
  '42501', null, 'removed session cannot create invitations');
select is((select authorization_state from public.get_auth_context()), 'unauthorized', 'removed session has no route authorization');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000020',
  'session_id', '82000000-0000-4000-8000-000000000020'
)::text, true);
select throws_ok($$select public.create_employee_invitation('expired-session-forged@example.test')$$,
  '42501', null, 'expired session cannot create invitations');

-- Manager supplies only the three permitted form values.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000001',
  'session_id', '82000000-0000-4000-8000-000000000001',
  'user_metadata', jsonb_build_object('organization_id', '83000000-0000-4000-8000-000000000002')
)::text, true);
select is(current_user::text, 'authenticated', 'manager mutation tests use actual authenticated database role');
select is(auth.uid(), '81000000-0000-4000-8000-000000000001'::uuid, 'manager mutation tests bind expected JWT subject');
select ok(public.create_employee_invitation(
  '  INVITE.NEW-EMPLOYEE@EXAMPLE.TEST  ', '  Fictieve medewerker  ', '  TEST-006  '
) is not null, 'active manager creates one employee invitation');
select is((select organization_id from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  '83000000-0000-4000-8000-000000000001'::uuid, 'server ignores forged metadata tenant and derives manager own tenant');
select is((select intended_role from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  'employee', 'creation hardcodes employee role');
select is((select display_name from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  'Fictieve medewerker', 'display name is trimmed before storage');
select is((select employee_code from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  'TEST-006', 'employee code is trimmed before storage');
select is((select expires_at - created_at from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  interval '24 hours', 'invitation expires after fixed reasonable interval');
select is(public.create_employee_invitation('invite.new-employee@example.test'), null::uuid,
  'duplicate usable pending invitation returns nondisclosing no-op');
select is(public.create_employee_invitation('invite.employee-a@example.test'), null::uuid,
  'duplicate active membership returns same nondisclosing no-op');
select is(public.create_employee_invitation('invite.manager-b@example.test'), null::uuid,
  'existing active member in another organization cannot acquire second active tenant');
select is(public.create_employee_invitation('invite.dormant-manager@example.test'), null::uuid,
  'manager membership is not converted into employee invitation');
select throws_ok(
  $$select public.create_employee_invitation(employee_email => 'forced@example.test', organization_id => '83000000-0000-4000-8000-000000000002')$$,
  '42883', null, 'client organization argument is rejected instead of trusted'
);
select throws_ok(
  $$select public.create_employee_invitation(employee_email => 'forced@example.test', intended_role => 'manager')$$,
  '42883', null, 'client role argument is rejected instead of trusted'
);
select throws_ok($$select public.create_employee_invitation('not-an-email')$$,
  '22023', 'Controleer de ingevulde gegevens.', 'invalid email is rejected by database');
select throws_ok($$select public.create_employee_invitation('valid@example.test', repeat('x', 121))$$,
  '22023', null, 'oversized display name is rejected by database');
select throws_ok($$select public.create_employee_invitation('valid@example.test', null, repeat('x', 33))$$,
  '22023', null, 'oversized employee code is rejected by database');
select ok(public.create_employee_invitation('invite.stale@example.test') is not null,
  'stale pending invitation can be replaced in manager own tenant');
select is((select count(*) from public.invitations where normalized_email = 'invite.stale@example.test' and status = 'expired'),
  1::bigint, 'replacement explicitly expires stale pending slot');
select is((select count(*) from public.invitations where normalized_email = 'invite.stale@example.test' and status = 'pending'),
  1::bigint, 'replacement creates only one new pending slot');
select is((select count(*) from public.audit_events where action = 'employee_invitation.created'),
  2::bigint, 'only successful creations append creation audit events');
select ok(not exists (select 1 from public.audit_events
  where action = 'employee_invitation.created'
    and (before_data is not null or after_data <> '{"status":"pending","role":"employee"}'::jsonb)),
  'creation audit has fixed minimal payload without email, name, code, token, or link');

-- Second manager cannot create an ambiguous invitation for same email.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000003',
  'session_id', '82000000-0000-4000-8000-000000000003'
)::text, true);
select is(public.create_employee_invitation('invite.new-employee@example.test'), null::uuid,
  'cross-tenant usable duplicate also returns nondisclosing no-op');
select is((select count(*) from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  0::bigint, 'manager B cannot see or mutate manager A invitation');

-- Mismatched JWT email is not proof: use current verified auth.users email.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000007',
  'session_id', '82000000-0000-4000-8000-000000000007',
  'email', 'invite.mismatch-target@example.test',
  'user_metadata', jsonb_build_object('email', 'invite.mismatch-target@example.test')
)::text, true);
select is(public.get_employee_invitation_state(), 'unavailable', 'mismatched real Auth email blocks password preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'mismatched real Auth email blocks acceptance');

select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000008',
  'session_id', '82000000-0000-4000-8000-000000000008'
)::text, true);
select is(public.get_employee_invitation_state(), 'unavailable', 'unverified Auth email blocks password preflight');
select throws_ok($$select public.accept_employee_invitation()$$, '42501', null, 'unverified Auth email blocks acceptance');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000009',
  'session_id', '82000000-0000-4000-8000-000000000009'
)::text, true);
select is(public.get_employee_invitation_state(), 'ready', 'passwordless invitee can reach password creation');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', null, 'acceptance cannot bypass initial Auth password creation');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000010',
  'session_id', '82000000-0000-4000-8000-000000000010'
)::text, true);
select is(public.get_employee_invitation_state(), 'unavailable', 'revoked invitation fails preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'revoked invitation fails safely');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000011',
  'session_id', '82000000-0000-4000-8000-000000000011'
)::text, true);
select is(public.get_employee_invitation_state(), 'unavailable', 'expired pending invitation fails preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'expired pending invitation fails safely');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000015',
  'session_id', '82000000-0000-4000-8000-000000000015'
)::text, true);
select is(public.get_employee_invitation_state(), 'unsupported', 'multiple viable tenant invitations deny automatic choice');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', null, 'multiple invitations cannot activate arbitrary tenant');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000014',
  'session_id', '82000000-0000-4000-8000-000000000014'
)::text, true);
select is(public.get_employee_invitation_state(), 'unavailable', 'existing manager role blocks employee invitation preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', null, 'acceptance cannot demote or reactivate a manager membership');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000023',
  'session_id', '82000000-0000-4000-8000-000000000023'
)::text, true);
select is(public.get_employee_invitation_state(), 'unavailable', 'suspended target organization blocks preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', null, 'suspended target organization blocks acceptance');

-- No mutation occurred on any denied acceptance.
reset role;
select is((select count(*) from public.profiles
  where user_id in (
    '81000000-0000-4000-8000-000000000007', '81000000-0000-4000-8000-000000000008',
    '81000000-0000-4000-8000-000000000009', '81000000-0000-4000-8000-000000000010',
    '81000000-0000-4000-8000-000000000011', '81000000-0000-4000-8000-000000000015',
    '81000000-0000-4000-8000-000000000023'
  )), 0::bigint, 'denied acceptance creates no profiles');
select is((select count(*) from public.audit_events where action = 'employee_invitation.accepted'),
  0::bigint, 'denied acceptance appends no success audit');
select ok((select role = 'manager' and status = 'inactive' from public.memberships
  where user_id = '81000000-0000-4000-8000-000000000014'),
  'denied manager acceptance preserves original role and status');
select is((select count(*) from public.invitations where accepted_by is not null),
  0::bigint, 'denied acceptance marks no invitation accepted');

set local role authenticated;
-- A real verified invitee still needs its own current Auth session. Forged
-- claims, including a different user's real session, cannot complete acceptance.
set local "request.jwt.claims" = '{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000006"}';
select is(public.get_employee_invitation_state(), 'unavailable', 'missing session claim blocks invitation preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'missing session claim blocks acceptance');
set local "request.jwt.claims" = '{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000006","session_id":"82000000-0000-4000-8000-999999999999"}';
select is(public.get_employee_invitation_state(), 'unavailable', 'forged session claim blocks invitation preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'forged session claim blocks acceptance');
set local "request.jwt.claims" = '{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000006","session_id":"not-a-uuid"}';
select is(public.get_employee_invitation_state(), 'unavailable', 'malformed session claim fails safely without cast errors');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'malformed session claim blocks acceptance generically');
set local "request.jwt.claims" = '{"role":"authenticated","sub":"81000000-0000-4000-8000-000000000006","session_id":"82000000-0000-4000-8000-000000000001"}';
select is(public.get_employee_invitation_state(), 'unavailable', 'another user session cannot authorize invitation preflight');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'another user session cannot authorize acceptance');
set local "request.jwt.claims" = '{"role":"authenticated","session_id":"82000000-0000-4000-8000-000000000006"}';
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'session claim alone cannot replace authenticated subject');

reset role;
select is((select count(*) from public.profiles where user_id = '81000000-0000-4000-8000-000000000006'),
  0::bigint, 'denied session attempts leave invitee profile absent');
select is((select count(*) from public.memberships where user_id = '81000000-0000-4000-8000-000000000006'),
  0::bigint, 'denied session attempts leave invitee membership absent');
select is((select status from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  'pending', 'denied session attempts leave invitation pending');
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000006',
  'session_id', '82000000-0000-4000-8000-000000000006'
)::text, true);
select is(public.get_employee_invitation_state(), 'ready', 'verified invited employee may create password');
select is((select authorization_state from public.get_auth_context()), 'unauthorized', 'invitation alone grants no role route access');
select throws_ok(
  $$select public.accept_employee_invitation(organization_id => '83000000-0000-4000-8000-000000000002')$$,
  '42883', null, 'acceptance rejects browser-selected organization'
);
select ok(public.accept_employee_invitation() is not null, 'verified password-ready employee accepts invitation');
select is((select count(*) from public.memberships where user_id = auth.uid() and status = 'active'),
  1::bigint, 'acceptance creates exactly one active membership');
select is((select role from public.memberships where user_id = auth.uid()), 'employee', 'accepted membership is employee only');
select is((select employee_code from public.memberships where user_id = auth.uid()), 'TEST-006', 'membership code comes from trusted invitation');
select is((select display_name from public.profiles where user_id = auth.uid()), 'Fictieve medewerker', 'profile name comes from trusted invitation');
select is((select authorization_state from public.get_auth_context()), 'authorized', 'successful acceptance grants role route access');
select is((select membership_role from public.get_auth_context()), 'employee', 'accepted employee routes as employee');
select is(public.get_employee_invitation_state(), 'unavailable', 'accepted invitation cannot reenter password creation');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'accepted invitation cannot be replayed');
select is((select count(*) from public.memberships where user_id = auth.uid()), 1::bigint, 'replay creates no duplicate membership');

-- Existing employee membership completes without changing its identity.
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000012',
  'session_id', '82000000-0000-4000-8000-000000000012'
)::text, true);
select is((select authorization_state from public.get_auth_context()), 'unauthorized', 'invited membership cannot access role route');
select is(public.accept_employee_invitation(), '84000000-0000-4000-8000-000000000012'::uuid,
  'existing invited employee membership is activated in place');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000013',
  'session_id', '82000000-0000-4000-8000-000000000013'
)::text, true);
select is((select authorization_state from public.get_auth_context()), 'unauthorized', 'inactive employee cannot access role route');
select is(public.accept_employee_invitation(), '84000000-0000-4000-8000-000000000013'::uuid,
  'explicit new invitation activates existing inactive employee membership in place');
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000022',
  'session_id', '82000000-0000-4000-8000-000000000022'
)::text, true);
select ok(public.accept_employee_invitation() is not null, 'existing-profile invitee can accept invitation');
select is((select display_name from public.profiles where user_id = auth.uid()), 'Bestaande profielnaam',
  'acceptance preserves existing user-owned profile name');

reset role;
select ok((select status = 'accepted'
    and accepted_by = '81000000-0000-4000-8000-000000000006'::uuid
    and accepted_at >= created_at and accepted_at < expires_at and revoked_at is null
  from public.invitations where normalized_email = 'invite.new-employee@example.test'),
  'acceptance stores correct actor and timestamp with coherent invitation state');
select is((select count(*) from public.audit_events where action = 'employee_invitation.accepted'),
  4::bigint, 'four successful acceptances append exactly four audit events');
select ok(not exists (select 1 from public.audit_events as audit_event
  where audit_event.action = 'employee_invitation.accepted'
    and (audit_event.before_data is not null
      or audit_event.after_data - array['status', 'membership_id'] <> '{}'::jsonb
      or audit_event.after_data ->> 'status' <> 'accepted'
      or not exists (select 1 from public.memberships as membership
        where membership.id::text = audit_event.after_data ->> 'membership_id'
          and membership.user_id = audit_event.actor_user_id
          and membership.organization_id = audit_event.organization_id))),
  'acceptance audits contain only state and exact authorized membership identity');
select is((select count(*) from public.memberships where user_id in (
  '81000000-0000-4000-8000-000000000006', '81000000-0000-4000-8000-000000000012',
  '81000000-0000-4000-8000-000000000013', '81000000-0000-4000-8000-000000000022'
) and role = 'employee' and status = 'active'), 4::bigint,
  'each successful invitee has exactly one active employee membership');

-- Fail the final audit insert after all business writes. The exception must
-- roll back profile, membership, and invitation changes as one transaction.
-- Test-only trigger/function are removed below and the whole suite rolls back.
insert into public.invitations (
  id, organization_id, normalized_email, invited_by, expires_at, display_name
) values (
  '85000000-0000-4000-8000-000000000021', '83000000-0000-4000-8000-000000000001',
  'invite.unaffiliated@example.test', '81000000-0000-4000-8000-000000000001',
  now() + interval '1 day', 'Transactiecontrole'
);
create function private.invitation_test_reject_audit()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'Synthetic audit failure';
end;
$$;
revoke all on function private.invitation_test_reject_audit()
  from public, anon, authenticated, service_role;
create trigger invitation_test_reject_audit
before insert on public.audit_events
for each row
when (new.action = 'employee_invitation.accepted'
  and new.actor_user_id = '81000000-0000-4000-8000-000000000021'::uuid)
execute function private.invitation_test_reject_audit();

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000021',
  'session_id', '82000000-0000-4000-8000-000000000021'
)::text, true);
select is(public.get_employee_invitation_state(), 'ready', 'atomicity fixture is eligible before injected audit failure');
select throws_ok($$select public.accept_employee_invitation()$$,
  '55000', 'Synthetic audit failure', 'final audit failure aborts entire acceptance');
reset role;
select is((select count(*) from public.profiles where user_id = '81000000-0000-4000-8000-000000000021'),
  0::bigint, 'audit failure rolls back profile insertion');
select is((select count(*) from public.memberships where user_id = '81000000-0000-4000-8000-000000000021'),
  0::bigint, 'audit failure rolls back membership insertion');
select ok((select status = 'pending' and accepted_by is null and accepted_at is null
  from public.invitations where id = '85000000-0000-4000-8000-000000000021'),
  'audit failure rolls back invitation state and accepting actor/timestamp');
select is((select count(*) from public.audit_events
  where actor_user_id = '81000000-0000-4000-8000-000000000021'),
  0::bigint, 'audit failure leaves no partial success audit');
drop trigger invitation_test_reject_audit on public.audit_events;
drop function private.invitation_test_reject_audit();

set local role authenticated;
select ok(public.accept_employee_invitation() is not null,
  'invitation remains usable after fully rolled-back transaction');
select is((select count(*) from public.memberships where user_id = auth.uid()),
  1::bigint, 'successful retry creates one membership after audit rollback');
select throws_ok($$select public.accept_employee_invitation()$$,
  '42501', 'Deze uitnodiging is niet beschikbaar.', 'successful retry is still protected from replay');
reset role;
select is((select count(*) from public.audit_events
  where actor_user_id = '81000000-0000-4000-8000-000000000021'
    and action = 'employee_invitation.accepted'),
  1::bigint, 'successful retry appends exactly one acceptance audit');

-- Removing current session invalidates subsequent RPC use without JWT refresh.
delete from auth.sessions where id = '82000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object(
  'role', 'authenticated', 'sub', '81000000-0000-4000-8000-000000000001',
  'session_id', '82000000-0000-4000-8000-000000000001'
)::text, true);
select throws_ok($$select public.create_employee_invitation('after-logout@example.test')$$,
  '42501', null, 'session removal immediately prevents invitation mutations');
select is((select authorization_state from public.get_auth_context()), 'unauthorized',
  'same stale JWT loses route authorization after session removal');

select * from finish();
rollback;
