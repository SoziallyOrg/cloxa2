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

select plan(36);

-- Fixtures (rolled back). Org A: owner u1, manager u2, employee u3. Org B: owner u4.
insert into auth.users (id, email)
select ('00000000-0000-4000-8000-00000000010' || n)::uuid, 'audit-u' || n || '@example.test'
from generate_series(1, 4) as n;

insert into public.organizations (id, name) values
  ('10000000-0000-4000-8000-00000000010a', 'Audit Org A'),
  ('10000000-0000-4000-8000-00000000010b', 'Audit Org B');

insert into public.memberships (organization_id, user_id, role, status) values
  ('10000000-0000-4000-8000-00000000010a', '00000000-0000-4000-8000-000000000101', 'owner', 'active'),
  ('10000000-0000-4000-8000-00000000010a', '00000000-0000-4000-8000-000000000102', 'manager', 'active'),
  ('10000000-0000-4000-8000-00000000010a', '00000000-0000-4000-8000-000000000103', 'employee', 'active'),
  ('10000000-0000-4000-8000-00000000010b', '00000000-0000-4000-8000-000000000104', 'owner', 'active');

-- Four audit rows in A (actor u1), two in B (system actor).
select pg_temp.login('00000000-0000-4000-8000-000000000101');
do $$
begin
  perform private.write_audit('10000000-0000-4000-8000-00000000010a', 'test.first', 'organization', '10000000-0000-4000-8000-00000000010a', '{"n": 1}');
  perform private.write_audit('10000000-0000-4000-8000-00000000010a', 'test.second', 'organization', null, '{"n": 2, "a": [1, 2]}');
  perform private.write_audit('10000000-0000-4000-8000-00000000010a', 'test.third', 'organization', null);
  perform private.write_audit('10000000-0000-4000-8000-00000000010a', 'test.fourth', 'organization', null, '{"n": 4}');
end;
$$;
set local "request.jwt.claims" = '{"role":"service_role"}';
do $$
begin
  perform private.write_audit('10000000-0000-4000-8000-00000000010b', 'test.first', 'organization', null);
  perform private.write_audit('10000000-0000-4000-8000-00000000010b', 'test.second', 'organization', null);
end;
$$;

create temporary table chain_a on commit drop as
select log.*, row_number() over (order by log.created_at) as position
from public.audit_log as log
where log.organization_id = '10000000-0000-4000-8000-00000000010a';

-- Structure -----------------------------------------------------------------

select columns_are(
  'public', 'audit_log',
  array['id', 'organization_id', 'actor_user_id', 'action', 'entity', 'entity_id', 'metadata', 'created_at', 'prev_hash', 'hash'],
  'audit_log has the contract columns'
);

-- Chain ------------------------------------------------------------------------

select is(
  (select actor_user_id from chain_a where position = 1),
  '00000000-0000-4000-8000-000000000101'::uuid,
  'write_audit records auth.uid() as actor'
);
select is(
  (select prev_hash from chain_a where position = 1),
  '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea,
  'first row of an org chains from 32 zero bytes'
);
select is(
  (select count(*) from chain_a as cur join chain_a as prev on prev.position = cur.position - 1 where cur.prev_hash = prev.hash),
  3::bigint,
  'each later row links to its predecessor hash'
);
select is(
  (select hash from chain_a where position = 2),
  (select extensions.digest(
    prev_hash || convert_to(
      id::text || '|' || organization_id::text || '|' || actor_user_id::text || '|' || action || '|'
      || entity || '||' || metadata::text || '|'
      || ((extract(epoch from created_at) * 1000000)::bigint)::text,
      'UTF8'),
    'sha256') from chain_a where position = 2),
  'hash = sha256(prev_hash || canonical bytes)'
);
select is(
  (select prev_hash from public.audit_log where organization_id = '10000000-0000-4000-8000-00000000010b' order by created_at limit 1),
  '\x0000000000000000000000000000000000000000000000000000000000000000'::bytea,
  'every org has its own chain starting at genesis'
);
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'), null, 'valid chain of org A verifies');
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010b'), null, 'valid chain of org B verifies');

-- concat_ws skips nulls; every nullable field must still occupy its slot.
select is(
  (select length(c) - length(replace(c, '|', ''))
   from (select private.audit_log_canonical(row(
     gen_random_uuid(), '10000000-0000-4000-8000-00000000010a', null, 'x.y', 'organization', null, null, null, null, null
   )::public.audit_log) as c) as canonical),
  7, 'canonical bytes keep all 8 fields (7 separators) when nullable fields are null'
);

set local role service_role;
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'), null, 'service_role can run the audit verification');
select throws_ok(
  $$select private.write_audit('10000000-0000-4000-8000-00000000010a', 'x.y', 'organization', null)$$,
  '42501', null, 'service_role cannot call write_audit'
);
reset role;

-- Read access -------------------------------------------------------------------

set local role authenticated;
select pg_temp.login('00000000-0000-4000-8000-000000000101', '1 minute');
select is((select count(*) from public.audit_log), 4::bigint, 'owner with aal2 reads exactly the audit rows of own org');

select pg_temp.login('00000000-0000-4000-8000-000000000102', '1 minute');
select is((select count(*) from public.audit_log), 4::bigint, 'manager with aal2 reads the audit rows of own org');

select pg_temp.login('00000000-0000-4000-8000-000000000101');
select is((select count(*) from public.audit_log), 0::bigint, 'owner without aal2 reads no audit rows');

select pg_temp.login('00000000-0000-4000-8000-000000000103', '1 minute');
select is((select count(*) from public.audit_log), 0::bigint, 'employee reads no audit rows');

select pg_temp.login('00000000-0000-4000-8000-000000000104', '1 minute');
select is(
  (select count(*) from public.audit_log where organization_id = '10000000-0000-4000-8000-00000000010a'),
  0::bigint, 'owner of org B reads nothing of org A'
);
select is((select count(*) from public.audit_log), 2::bigint, 'owner of org B reads own org rows');

-- Append-only, for privileged users ... -------------------------------------------

select pg_temp.login('00000000-0000-4000-8000-000000000101', '1 minute');
select throws_ok(
  $$insert into public.audit_log (organization_id, action, entity, prev_hash, hash)
    values ('10000000-0000-4000-8000-00000000010b', 'forged.row', 'organization', '\x00', '\x00')$$,
  '42501', null, 'privileged user cannot insert audit rows (not even into another org)'
);
select throws_ok($$update public.audit_log set action = 'x.y'$$, '42501', null, 'privileged user cannot update audit rows');
select throws_ok($$delete from public.audit_log$$, '42501', null, 'privileged user cannot delete audit rows');
select throws_ok($$truncate public.audit_log$$, '42501', null, 'privileged user cannot truncate the audit log');
select throws_ok($$select private.write_audit('10000000-0000-4000-8000-00000000010a', 'x.y', 'organization', null)$$, '42501', null, 'authenticated cannot call write_audit');
reset role;

-- ... and for the table owner, through the triggers.
select throws_ok($$update public.audit_log set action = 'x.y'$$, '55000', 'audit_log is append-only', 'owner cannot update audit rows');
select throws_ok($$delete from public.audit_log$$, '55000', 'audit_log is append-only', 'owner cannot delete audit rows');
select throws_ok($$truncate public.audit_log$$, '55000', 'audit_log is append-only', 'owner cannot truncate the audit log');
select throws_ok(
  $$insert into public.audit_log (id, organization_id, action, entity, prev_hash, hash)
    select id, organization_id, 'x.y', 'organization', prev_hash, hash from chain_a where position = 1
    on conflict (id) do update set action = 'x.y'$$,
  '55000', 'audit_log is append-only', 'INSERT ... ON CONFLICT DO UPDATE cannot rewrite an audit row'
);
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'), null, 'the rejected upsert left the chain and its head intact');

-- Forged hashes on insert are ignored: the trigger always computes them.
do $$
begin
  perform private.write_audit('10000000-0000-4000-8000-00000000010b', 'test.third', 'organization', null);
end;
$$;
insert into public.audit_log (organization_id, action, entity, prev_hash, hash)
values ('10000000-0000-4000-8000-00000000010b', 'test.forged', 'organization', '\x00', '\x00');
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010b'), null, 'client-supplied hashes are replaced by the chain trigger');

-- Tampering (as superuser, trigger disabled) is detected ---------------------------

alter table public.audit_log disable trigger audit_log_reject_update_delete;

update public.audit_log set metadata = '{"n": 99}'
where id = (select id from chain_a where position = 2);
select is(
  private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'),
  (select id from chain_a where position = 2),
  'content tampering is reported at the tampered row'
);

-- Re-hashing the tampered row moves the break to its successor.
update public.audit_log as log
set hash = private.chain_hash(log.prev_hash, private.audit_log_canonical(log))
where id = (select id from chain_a where position = 2);
select is(
  private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'),
  (select id from chain_a where position = 3),
  'a re-hashed tampered row breaks the link to the next row'
);

update public.audit_log as log
set metadata = original.metadata, hash = original.hash
from chain_a as original
where original.position = 2 and log.id = original.id;
select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'), null, 'restored chain verifies again');

delete from public.audit_log where id = (select id from chain_a where position = 3);
select is(
  private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'),
  (select id from chain_a where position = 4),
  'a deleted middle row is reported at its successor'
);

delete from public.audit_log where id = (select id from chain_a where position = 4);
select is(
  private.verify_audit_chain('10000000-0000-4000-8000-00000000010a'),
  (select id from chain_a where position = 4),
  'a deleted tail is reported as the missing recorded head'
);

alter table public.audit_log enable trigger audit_log_reject_update_delete;

select is(private.verify_audit_chain('10000000-0000-4000-8000-00000000010b'), null, 'tampering in org A does not affect org B');

-- The chain head table has no guard trigger; edits to it are still caught.
update private.hash_chain_heads set length = length + 1
where organization_id = '10000000-0000-4000-8000-00000000010b' and chain = 'audit_log';
select is(
  private.verify_audit_chain('10000000-0000-4000-8000-00000000010b'),
  (select head_id from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000010b' and chain = 'audit_log'),
  'a tampered head length is reported'
);
update private.hash_chain_heads set length = length - 1,
  head_hash = extensions.digest('forged', 'sha256')
where organization_id = '10000000-0000-4000-8000-00000000010b' and chain = 'audit_log';
select is(
  private.verify_audit_chain('10000000-0000-4000-8000-00000000010b'),
  (select head_id from private.hash_chain_heads where organization_id = '10000000-0000-4000-8000-00000000010b' and chain = 'audit_log'),
  'a tampered head hash is reported'
);

select * from finish();
rollback;
