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

select plan(78);

-- Fixtures (rolled back). Org A: owner u1 (A1), admin u2 (A1), manager u3
-- (clocks at and manages A1), employee u4 (A1). Site A2 is not managed by u3.
-- Org B: owner u5. u7, u8, u9 are auth users created by inviteUserByEmail.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000070' || n)::uuid, 'invite-u' || n || '@example.test'
from generate_series(1, 9) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000070a', 'Invite Org A'),
  ('10000000-0000-4000-8000-00000000070b', 'Invite Org B');

insert into public.sites (id, organization_id, name) values
  ('20000000-0000-4000-8000-0000000007a1', '10000000-0000-4000-8000-00000000070a', 'Site A1'),
  ('20000000-0000-4000-8000-0000000007a2', '10000000-0000-4000-8000-00000000070a', 'Site A2'),
  ('20000000-0000-4000-8000-0000000007b1', '10000000-0000-4000-8000-00000000070b', 'Site B1');

insert into public.memberships (id, organization_id, user_id, role, status)
select ('30000000-0000-4000-8000-00000000070' || n)::uuid,
  case when n = 5 then '10000000-0000-4000-8000-00000000070b' else '10000000-0000-4000-8000-00000000070a' end::uuid,
  ('00000000-0000-4000-8000-00000000070' || n)::uuid,
  (array['owner', 'admin', 'manager', 'employee', 'owner'])[n],
  'active'
from generate_series(1, 5) as n;

insert into public.employees (id, organization_id, user_id, display_name)
select ('40000000-0000-4000-8000-00000000070' || n)::uuid,
  case when n = 5 then '10000000-0000-4000-8000-00000000070b' else '10000000-0000-4000-8000-00000000070a' end::uuid,
  ('00000000-0000-4000-8000-00000000070' || n)::uuid,
  'Invite employee ' || n
from generate_series(1, 5) as n;

insert into public.site_assignments (organization_id, site_id, employee_id, membership_id) values
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000701', null),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000702', null),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000703', null),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000704', null),
  ('10000000-0000-4000-8000-00000000070b', '20000000-0000-4000-8000-0000000007b1', '40000000-0000-4000-8000-000000000705', null),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', null, '30000000-0000-4000-8000-000000000703');

-- More fixtures: second admin u10 (A1), employee u14 (A2, unmanaged by u3).
-- u11-u13 are invitees; u12's auth user is deleted.
insert into auth.users (id, email, deleted_at)
select ('00000000-0000-4000-8000-0000000007' || n)::uuid, 'invite-u' || n || '@example.test',
  case when n = 12 then now() end
from generate_series(10, 14) as n;

insert into public.memberships (id, organization_id, user_id, role, status) values
  ('30000000-0000-4000-8000-000000000710', '10000000-0000-4000-8000-00000000070a', '00000000-0000-4000-8000-000000000710', 'admin', 'active'),
  ('30000000-0000-4000-8000-000000000714', '10000000-0000-4000-8000-00000000070a', '00000000-0000-4000-8000-000000000714', 'employee', 'active');
insert into public.employees (id, organization_id, user_id, display_name) values
  ('40000000-0000-4000-8000-000000000710', '10000000-0000-4000-8000-00000000070a', '00000000-0000-4000-8000-000000000710', 'Invite admin 10'),
  ('40000000-0000-4000-8000-000000000714', '10000000-0000-4000-8000-00000000070a', '00000000-0000-4000-8000-000000000714', 'Invite employee 14');
insert into public.site_assignments (organization_id, site_id, employee_id) values
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a1', '40000000-0000-4000-8000-000000000710'),
  ('10000000-0000-4000-8000-00000000070a', '20000000-0000-4000-8000-0000000007a2', '40000000-0000-4000-8000-000000000714');

create temporary table inv (label text, id uuid) on commit drop;
grant select, insert on inv to authenticated, service_role;

select columns_are(
  'public', 'invitations',
  array[
    'id', 'organization_id', 'email', 'role', 'employee_id', 'site_ids', 'invited_by', 'status', 'user_id',
    'membership_id', 'created_at', 'updated_at', 'expires_at'
  ],
  'invitations keeps role, sites, link state and expiry; no token'
);

-- Invite role rules ---------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000703', '1 minute');

insert into inv select 'u7', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', '  Invite-U7@Example.TEST ', 'employee', ' Nieuwe Medewerker ',
  array['20000000-0000-4000-8000-0000000007a1']::uuid[], 'E-007', 'student', 'nl-BE');

select ok((select id is not null from inv where label = 'u7'), 'a manager invites an employee to a managed site');
select results_eq(
  $$select email, role, status, invited_by, user_id, site_ids from public.invitations where id = (select id from inv where label = 'u7')$$,
  $$values ('invite-u7@example.test'::text, 'employee'::text, 'pending'::text, '00000000-0000-4000-8000-000000000703'::uuid,
    null::uuid, array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  'the invitation is pending with a lowercased email'
);
select results_eq(
  $$select e.display_name, e.employee_code, e.statute, e.user_id, e.active
    from public.employees as e join public.invitations as i on i.employee_id = e.id where i.id = (select id from inv where label = 'u7')$$,
  $$values ('Nieuwe Medewerker'::text, 'E-007'::text, 'student'::text, null::uuid, true)$$,
  'the employee row exists without a login'
);
select is(
  (select count(*) from public.site_assignments as a join public.invitations as i on i.employee_id = a.employee_id
   where i.id = (select id from inv where label = 'u7') and a.site_id = '20000000-0000-4000-8000-0000000007a1'),
  1::bigint, 'the new employee is assigned to the requested site'
);

select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'manager', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '42501', 'role_not_allowed', 'a manager cannot invite a manager'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'admin', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '42501', 'role_not_allowed', 'a manager cannot invite an admin'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a2']::uuid[])$$,
  '42501', 'site_not_managed', 'a manager cannot place an employee on an unmanaged site'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a1', '20000000-0000-4000-8000-0000000007a2']::uuid[])$$,
  '42501', 'site_not_managed', 'a manager cannot mix managed and unmanaged sites'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X', '{}')$$,
  '42501', 'site_not_managed', 'a manager must place the employee on a managed site'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'invite-u7@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '23505', 'already_invited', 'an email has one open invitation per org'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'INVITE-U4@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '23505', 'already_member', 'an existing member cannot be invited again'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'not-an-email', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '22023', 'invalid_email', 'a malformed email is rejected'
);
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007b1']::uuid[])$$,
  '22023', 'invalid_site', 'a site of another org is rejected'
);

select pg_temp.login('00000000-0000-4000-8000-000000000703', '13 hours');
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '42501', 'not_authorized', 'stale MFA cannot invite'
);
select pg_temp.login('00000000-0000-4000-8000-000000000704', '1 minute');
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X',
    array['20000000-0000-4000-8000-0000000007a1']::uuid[])$$,
  '42501', 'not_authorized', 'an employee cannot invite'
);
select pg_temp.login('00000000-0000-4000-8000-000000000705', '1 minute');
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x1@example.test', 'employee', 'X', '{}')$$,
  '42501', 'not_authorized', 'the owner of org B cannot invite into org A'
);

select pg_temp.login('00000000-0000-4000-8000-000000000702', '1 minute');
insert into inv select 'u8', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u8@example.test', 'manager', 'Nieuwe Manager',
  array['20000000-0000-4000-8000-0000000007a1', '20000000-0000-4000-8000-0000000007a2']::uuid[]);
select ok((select id is not null from inv where label = 'u8'), 'an admin invites a manager');
select pg_temp.login('00000000-0000-4000-8000-000000000701', '1 minute');
insert into inv select 'u9', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u9@example.test', 'admin', 'Nieuwe Admin', '{}');
select ok((select id is not null from inv where label = 'u9'), 'an owner invites an admin without sites');
select throws_ok(
  $$select public.rpc_invite_member('10000000-0000-4000-8000-00000000070a', 'x2@example.test', 'owner', 'X', '{}')$$,
  '22023', 'invalid_role', 'ownership is never handed out by invitation'
);

-- Invitation reads through RLS.
select is(
  (select count(*) from public.invitations where organization_id = '10000000-0000-4000-8000-00000000070a'),
  3::bigint, 'the owner sees every invitation of the org'
);
select pg_temp.login('00000000-0000-4000-8000-000000000703', '1 minute');
select results_eq(
  $$select id from public.invitations$$,
  $$select id from inv where label = 'u7'$$,
  'a manager sees only the invitations they sent'
);
select pg_temp.login('00000000-0000-4000-8000-000000000704');
select is((select count(*) from public.invitations), 0::bigint, 'an employee sees no invitations');
select pg_temp.login('00000000-0000-4000-8000-000000000705', '1 minute');
select is((select count(*) from public.invitations), 0::bigint, 'the owner of org B sees no org A invitations');
select throws_ok(
  $$update public.invitations set role = 'admin'$$,
  '42501', null, 'authenticated cannot update invitations directly'
);

-- Link (service_role only) ------------------------------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000701', '1 minute');
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u7'), '00000000-0000-4000-8000-000000000707')$$,
  '42501', null, 'authenticated cannot link invited users'
);
select throws_ok(
  $$select private.link_invited_user((select id from inv where label = 'u7'), '00000000-0000-4000-8000-000000000707')$$,
  '42501', null, 'the private link function is not executable by authenticated'
);
reset role;

create temporary table linked (label text, membership_id uuid) on commit drop;
grant select, insert on linked to authenticated, service_role;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
insert into linked select 'u7', public.rpc_link_invited_user((select id from inv where label = 'u7'), '00000000-0000-4000-8000-000000000707');
insert into linked select 'u7-again', public.rpc_link_invited_user((select id from inv where label = 'u7'), '00000000-0000-4000-8000-000000000707');
insert into linked select 'u8', public.rpc_link_invited_user((select id from inv where label = 'u8'), '00000000-0000-4000-8000-000000000708');
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u9'), '00000000-0000-4000-8000-000000000706')$$,
  '22023', 'user_email_mismatch', 'only the auth user with the invited email can be linked'
);
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u7'), '00000000-0000-4000-8000-000000000709')$$,
  '55000', 'invitation_not_pending', 'a linked invitation cannot be relinked to someone else'
);
reset role;

select is(
  (select membership_id from linked where label = 'u7-again'),
  (select membership_id from linked where label = 'u7'),
  'linking again with the same user is idempotent'
);
select results_eq(
  $$select m.user_id, m.role, m.status, i.status, e.user_id
    from public.invitations as i
    join public.memberships as m on m.id = i.membership_id
    join public.employees as e on e.id = i.employee_id
    where i.id = (select id from inv where label = 'u7')$$,
  $$values ('00000000-0000-4000-8000-000000000707'::uuid, 'employee'::text, 'invited'::text, 'linked'::text,
    '00000000-0000-4000-8000-000000000707'::uuid)$$,
  'linking creates an invited membership and attaches the login to the employee row'
);
select is(
  (select array_agg(site_id order by site_id) from public.site_assignments
   where membership_id = (select membership_id from linked where label = 'u8')),
  array['20000000-0000-4000-8000-0000000007a1', '20000000-0000-4000-8000-0000000007a2']::uuid[],
  'an invited manager manages the invitation sites'
);

-- Accept ---------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000707');
select is(
  (select count(*) from public.organizations), 0::bigint, 'an invited (not yet accepted) member sees no organization'
);
select results_eq(
  $$select organization_id, membership_id from public.rpc_accept_membership()$$,
  $$select '10000000-0000-4000-8000-00000000070a'::uuid, membership_id from linked where label = 'u7'$$,
  'the invited user accepts their membership'
);
select results_eq(
  $$select m.status, i.status from public.memberships as m join public.invitations as i on i.membership_id = m.id
    where m.user_id = '00000000-0000-4000-8000-000000000707'$$,
  $$values ('active'::text, 'accepted'::text)$$,
  'the membership is active and the invitation accepted'
);
select is((select count(*) from public.organizations), 1::bigint, 'after accepting, the member sees the organization');
select is((select count(*) from public.rpc_accept_membership()), 0::bigint, 'accepting again is a no-op');
select pg_temp.login('00000000-0000-4000-8000-000000000709');
select is((select count(*) from public.rpc_accept_membership()), 0::bigint, 'a user without an invitation accepts nothing');
select pg_temp.login('00000000-0000-4000-8000-000000000708');
select throws_ok(
  $$select public.rpc_clock('clock_in', gen_random_uuid(), '20000000-0000-4000-8000-0000000007a1')$$,
  '42501', 'not_authorized', 'an invited member who has not accepted cannot clock'
);
reset role;

-- Audit ---------------------------------------------------------------------------------------

select results_eq(
  $$select action, actor_user_id, metadata ? 'email' from public.audit_log
    where organization_id = '10000000-0000-4000-8000-00000000070a' and entity in ('invitation', 'membership')
    order by created_at$$,
  $$values
    ('member.invited'::text, '00000000-0000-4000-8000-000000000703'::uuid, false),
    ('member.invited', '00000000-0000-4000-8000-000000000702', false),
    ('member.invited', '00000000-0000-4000-8000-000000000701', false),
    ('member.linked', null, false),
    ('member.linked', null, false),
    ('member.accepted', '00000000-0000-4000-8000-000000000707', false)$$,
  'every invite, link and acceptance wrote one audit row without the email'
);

-- Revoke and expiry ------------------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000701', '1 minute');
insert into inv select 'rev_owner', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'rev-owner@example.test', 'employee', 'Door eigenaar', array['20000000-0000-4000-8000-0000000007a2']::uuid[]);
insert into inv select 'u6', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u6@example.test', 'employee', 'Wordt intussen lid', array['20000000-0000-4000-8000-0000000007a1']::uuid[]);
insert into inv select 'u12', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u12@example.test', 'employee', 'Verwijderd account', array['20000000-0000-4000-8000-0000000007a1']::uuid[]);
insert into inv select 'u13', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u13@example.test', 'employee', 'Verloopt', array['20000000-0000-4000-8000-0000000007a1']::uuid[]);
select pg_temp.login('00000000-0000-4000-8000-000000000703', '1 minute');
insert into inv select 'u11', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u11@example.test', 'employee', 'Wordt ingetrokken', array['20000000-0000-4000-8000-0000000007a1']::uuid[]);

select throws_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'rev_owner'))$$,
  '42501', 'not_authorized', 'a manager cannot revoke an invitation someone else sent'
);
select pg_temp.login('00000000-0000-4000-8000-000000000703', '13 hours');
select throws_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'u11'))$$,
  '42501', 'not_authorized', 'stale MFA cannot revoke'
);
select pg_temp.login('00000000-0000-4000-8000-000000000704', '1 minute');
select throws_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'u11'))$$,
  '42501', 'not_authorized', 'an employee cannot revoke'
);
select pg_temp.login('00000000-0000-4000-8000-000000000705', '1 minute');
select throws_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'u11'))$$,
  '42501', 'not_authorized', 'the owner of org B cannot revoke org A invitations'
);
select pg_temp.login('00000000-0000-4000-8000-000000000703', '1 minute');
select lives_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'u11'))$$,
  'a manager revokes an invitation they sent'
);
select results_eq(
  $$select i.status, e.active from public.invitations as i join public.employees as e on e.id = i.employee_id
    where i.id = (select id from inv where label = 'u11')$$,
  $$values ('revoked'::text, false)$$,
  'revoking closes the invitation and deactivates its employee row'
);
select throws_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'u11'))$$,
  '55000', 'invitation_not_open', 'a revoked invitation cannot be revoked again'
);
insert into inv select 'u11b', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u11@example.test', 'employee', 'Opnieuw uitgenodigd', array['20000000-0000-4000-8000-0000000007a1']::uuid[]);
select ok((select id is not null from inv where label = 'u11b'), 'a revoked invitation no longer blocks a new one for the same email');
reset role;

-- Membership appears between invite and link.
insert into public.memberships (organization_id, user_id, role, status)
values ('10000000-0000-4000-8000-00000000070a', '00000000-0000-4000-8000-000000000706', 'employee', 'suspended');
-- Expiry, simulated.
create temporary table linked_more (label text, membership_id uuid) on commit drop;
grant select, insert on linked_more to service_role;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u11'), '00000000-0000-4000-8000-000000000711')$$,
  '55000', 'invitation_revoked', 'a revoked invitation cannot be linked'
);
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u6'), '00000000-0000-4000-8000-000000000706')$$,
  '23505', 'already_member', 'a user who became a member meanwhile cannot be linked'
);
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u12'), '00000000-0000-4000-8000-000000000712')$$,
  '22023', 'user_email_mismatch', 'a deleted auth user cannot be linked'
);
insert into linked_more select 'u11b', public.rpc_link_invited_user((select id from inv where label = 'u11b'), '00000000-0000-4000-8000-000000000711');
insert into linked_more select 'u13', public.rpc_link_invited_user((select id from inv where label = 'u13'), '00000000-0000-4000-8000-000000000713');
reset role;

update public.invitations set expires_at = created_at + interval '1 microsecond'
where id = (select id from inv where label = 'u13');

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000702', '1 minute');
select lives_ok(
  $$select public.rpc_revoke_invitation((select id from inv where label = 'u11b'))$$,
  'an admin revokes a linked invitation'
);
select pg_temp.login('00000000-0000-4000-8000-000000000711');
select is((select count(*) from public.rpc_accept_membership()), 0::bigint, 'a revoked invitation cannot be accepted');
select pg_temp.login('00000000-0000-4000-8000-000000000713');
select is((select count(*) from public.rpc_accept_membership()), 0::bigint, 'an expired invitation cannot be accepted');
reset role;

select results_eq(
  $$select
    (select count(*) from public.memberships where organization_id = '10000000-0000-4000-8000-00000000070a' and user_id = '00000000-0000-4000-8000-000000000711'),
    (select user_id from public.employees where id = (select employee_id from public.invitations where id = (select id from inv where label = 'u11b'))),
    (select status from public.memberships where id = (select membership_id from linked_more where label = 'u13'))$$,
  $$values (0::bigint, null::uuid, 'invited'::text)$$,
  'revoking a linked invitation removes the unused membership and login link; an expired one stays unaccepted'
);

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select public.rpc_link_invited_user((select id from inv where label = 'u13'), '00000000-0000-4000-8000-000000000713')$$,
  '55000', 'invitation_expired', 'an expired invitation cannot be linked again'
);
reset role;

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000701', '1 minute');
insert into inv select 'u13b', public.rpc_invite_member(
  '10000000-0000-4000-8000-00000000070a', 'invite-u13@example.test', 'employee', 'Tweede kans', array['20000000-0000-4000-8000-0000000007a1']::uuid[]);
select results_eq(
  $$select status, membership_id from public.invitations where id = (select id from inv where label = 'u13')$$,
  $$values ('revoked'::text, null::uuid)$$,
  'an expired invitation no longer blocks a new one: it is closed first'
);
reset role;

-- A suspended membership is never activated by accepting.
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
insert into linked_more select 'u13b', public.rpc_link_invited_user((select id from inv where label = 'u13b'), '00000000-0000-4000-8000-000000000713');
reset role;
update public.memberships set status = 'suspended' where id = (select membership_id from linked_more where label = 'u13b');
set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000713');
select is((select count(*) from public.rpc_accept_membership()), 0::bigint, 'a suspended member cannot accept');
reset role;
select is(
  (select status from public.memberships where id = (select membership_id from linked_more where label = 'u13b')),
  'suspended', 'the suspended membership stays suspended'
);

select results_eq(
  $$select entity_id, actor_user_id, metadata ->> 'cause', metadata ? 'membership_id'
    from public.audit_log where action = 'member.invitation_revoked' order by created_at$$,
  $$select * from (values
    ((select id from inv where label = 'u11'), '00000000-0000-4000-8000-000000000703'::uuid, 'revoked'::text, false),
    ((select id from inv where label = 'u11b'), '00000000-0000-4000-8000-000000000702'::uuid, 'revoked', true),
    ((select id from inv where label = 'u13'), '00000000-0000-4000-8000-000000000701'::uuid, 'expired', true)) as expected$$,
  'every revocation and expiry closure is audited with its cause'
);

-- rpc_admin_create_organization (service_role) ------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000709', '1 minute');
select throws_ok(
  $$select * from public.rpc_admin_create_organization('Rogue', '00000000-0000-4000-8000-000000000709')$$,
  '42501', null, 'authenticated cannot create an organization'
);
reset role;

create temporary table bootstrap (organization_id uuid, site_id uuid, membership_id uuid, employee_id uuid) on commit drop;
grant insert on bootstrap to service_role;
set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
insert into bootstrap select * from public.rpc_admin_create_organization('Org C', '00000000-0000-4000-8000-000000000709', 'Owner C');
reset role;
select results_eq(
  $$select m.role, m.status, o.name from bootstrap as b
    join public.memberships as m on m.id = b.membership_id
    join public.organizations as o on o.id = b.organization_id$$,
  $$values ('owner'::text, 'active'::text, 'Org C'::text)$$,
  'service_role bootstraps an organization with an active owner'
);
select is(
  (select count(*) from public.audit_log where organization_id = (select organization_id from bootstrap) and action = 'organization.created'),
  1::bigint, 'the bootstrap is audited'
);

-- rpc_sign_out_everywhere ------------------------------------------------------------------------

insert into auth.sessions (id, user_id) values
  ('50000000-0000-4000-8000-000000000741', '00000000-0000-4000-8000-000000000704'),
  ('50000000-0000-4000-8000-000000000742', '00000000-0000-4000-8000-000000000704'),
  ('50000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000702'),
  ('50000000-0000-4000-8000-000000000701', '00000000-0000-4000-8000-000000000701');
insert into auth.refresh_tokens (token, user_id, session_id, revoked) values
  ('token-741', '00000000-0000-4000-8000-000000000704', '50000000-0000-4000-8000-000000000741', false),
  ('token-742', '00000000-0000-4000-8000-000000000704', '50000000-0000-4000-8000-000000000742', false),
  ('token-legacy', '00000000-0000-4000-8000-000000000704', null, false);

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000703', '13 hours');
select throws_ok(
  $$select public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000704')$$,
  '42501', 'not_authorized', 'stale MFA cannot sign anyone out'
);
select pg_temp.login('00000000-0000-4000-8000-000000000704', '1 minute');
select throws_ok(
  $$select public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000704')$$,
  '42501', 'not_authorized', 'an employee cannot use the privileged sign-out'
);
select pg_temp.login('00000000-0000-4000-8000-000000000705', '1 minute');
select throws_ok(
  $$select public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000704')$$,
  '42501', 'not_authorized', 'the owner of org B cannot sign out an org A employee'
);
select pg_temp.login('00000000-0000-4000-8000-000000000703', '1 minute');
select throws_ok(
  $$select public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000702')$$,
  '42501', 'not_authorized', 'a manager cannot sign out an admin'
);
select throws_ok(
  $$select public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000714')$$,
  '42501', 'not_authorized', 'a manager cannot sign out an employee of an unmanaged site'
);
select is(
  public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000704'),
  2, 'a manager signs out a managed employee everywhere'
);
select pg_temp.login('00000000-0000-4000-8000-000000000702', '1 minute');
select throws_ok(
  $$select public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000701')$$,
  '42501', 'not_authorized', 'an admin cannot sign out the owner'
);
select is(
  public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000710'),
  0, 'an admin may sign out another admin'
);
select throws_ok(
  $$select public.rpc_sign_out_everywhere((select employee_id from public.invitations where id = (select id from inv where label = 'u9')))$$,
  '22023', 'employee_has_no_login', 'an employee without a login has nothing to sign out'
);
select pg_temp.login('00000000-0000-4000-8000-000000000701', '1 minute');
select is(
  public.rpc_sign_out_everywhere('40000000-0000-4000-8000-000000000702'),
  1, 'the owner signs out an admin'
);
reset role;

select is(
  (select count(*) from auth.sessions where user_id in ('00000000-0000-4000-8000-000000000704', '00000000-0000-4000-8000-000000000702')),
  0::bigint, 'the signed-out users have no sessions left'
);
select is(
  (select count(*) from auth.refresh_tokens where user_id = '00000000-0000-4000-8000-000000000704'),
  0::bigint, 'their refresh tokens are gone too, including ones without a session'
);
select is(
  (select count(*) from auth.sessions where user_id = '00000000-0000-4000-8000-000000000701'),
  1::bigint, 'other users keep their sessions'
);
select results_eq(
  $$select entity_id, actor_user_id, metadata from public.audit_log where action = 'member.signed_out_everywhere' order by created_at$$,
  $$values
    ('40000000-0000-4000-8000-000000000704'::uuid, '00000000-0000-4000-8000-000000000703'::uuid,
     '{"user_id": "00000000-0000-4000-8000-000000000704", "sessions_revoked": 2}'::jsonb),
    ('40000000-0000-4000-8000-000000000710', '00000000-0000-4000-8000-000000000702',
     '{"user_id": "00000000-0000-4000-8000-000000000710", "sessions_revoked": 0}'),
    ('40000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000701',
     '{"user_id": "00000000-0000-4000-8000-000000000702", "sessions_revoked": 1}')$$,
  'every sign-out is audited'
);
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000070a'), null, 'the org A audit chain verifies');

select * from finish();
rollback;
