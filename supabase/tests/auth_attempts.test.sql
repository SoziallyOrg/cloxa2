begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(27);

-- sha256 of a label, as the Next server computes it (lowercased email or IP).
create function pg_temp.h(p_label text)
returns bytea
language sql
immutable
as $$
  select extensions.digest(p_label, 'sha256');
$$;
grant execute on function pg_temp.h(text) to service_role;

create temporary table outcome (label text, allowed boolean, retry_after integer) on commit drop;
grant select, insert on outcome to service_role;

-- p_count sequential calls with the same inputs, recorded as p_label01, p_label02, ...
create function pg_temp.attempts(p_label text, p_count integer, p_kind text, p_email text, p_ip text)
returns void
language plpgsql
as $$
begin
  for i in 1..p_count loop
    insert into outcome
    select p_label || lpad(i::text, 2, '0'), attempt.allowed, attempt.retry_after
    from public.rpc_auth_attempt(p_kind, pg_temp.h(p_email), pg_temp.h(p_ip)) as attempt;
  end loop;
end;
$$;
grant execute on function pg_temp.attempts(text, integer, text, text, text) to service_role;

-- Structure and grants ------------------------------------------------------------------

select columns_are(
  'private', 'auth_attempts', array['id', 'key_hash', 'kind', 'created_at'],
  'auth_attempts stores only a hash, a kind and a time'
);
select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.oid in (
      'public.rpc_auth_attempt(text, bytea, bytea)'::regprocedure,
      'public.rpc_auth_attempt_reset(bytea)'::regprocedure,
      'public.rpc_admin_create_organization(text, uuid, text)'::regprocedure,
      'public.rpc_link_invited_user(uuid, uuid)'::regprocedure
    )
      and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ),
  '{}'::text[],
  'service_role-only RPCs are executable by service_role and by nobody else'
);

set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000601"}';
select throws_ok(
  $$select * from public.rpc_auth_attempt('otp_request', pg_temp.h('a@example.test'), pg_temp.h('192.0.2.1'))$$,
  '42501', null, 'authenticated cannot record attempts'
);
select throws_ok(
  $$select public.rpc_auth_attempt_reset(pg_temp.h('a@example.test'))$$,
  '42501', null, 'authenticated cannot reset attempts'
);
select throws_ok($$select * from private.auth_attempts$$, '42501', null, 'authenticated cannot read attempts');
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.rpc_auth_attempt('otp_request', pg_temp.h('a@example.test'), pg_temp.h('192.0.2.1'))$$,
  '42501', null, 'anon cannot record attempts'
);
reset role;

-- otp_request: 3 per email, 20 per IP, per 15 minutes -------------------------------------

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

select pg_temp.attempts('a', 4, 'otp_request', 'a@example.test', '192.0.2.1');

select results_eq(
  $$select allowed from outcome where label ~ '^a[0-9]' order by label$$,
  $$values (true), (true), (true), (false)$$,
  'the fourth OTP request for one email within 15 minutes is blocked'
);
select ok(
  (select retry_after between 895 and 900 from outcome where label = 'a04'),
  'a blocked request reports when the oldest attempt leaves the window'
);
select is((select retry_after from outcome where label = 'a01'), 0, 'an allowed attempt reports retry_after 0');
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_request', pg_temp.h('b@example.test'), pg_temp.h('192.0.2.1'))$$,
  $$values (true)$$,
  'another email from the same IP is still allowed'
);

-- The IP now has 4 recorded requests; 16 more emails fill it to 20.
insert into outcome
select 'ip' || lpad(n::text, 2, '0'), attempt.allowed, attempt.retry_after
from generate_series(1, 17) as n
cross join lateral public.rpc_auth_attempt('otp_request', pg_temp.h('ip' || n || '@example.test'), pg_temp.h('192.0.2.1')) as attempt;

select is(
  (select count(*) from outcome where label like 'ip%' and allowed),
  16::bigint, 'an IP gets 20 OTP requests per 15 minutes'
);
select ok(
  (select not allowed and retry_after > 0 from outcome where label = 'ip17'),
  'the 21st request from one IP is blocked, whatever the email'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_request', pg_temp.h('ip17@example.test'), pg_temp.h('198.51.100.7'))$$,
  $$values (true)$$,
  'the same email from another IP is allowed'
);
select is(
  (select count(*) from outcome as o where not o.allowed),
  2::bigint, 'blocked attempts are not recorded as attempts'
);
reset role;
select is(
  (select count(*) from private.auth_attempts where key_hash = pg_temp.h('a@example.test')),
  3::bigint, 'only the three allowed requests of one email were recorded'
);

-- Old rows neither count nor stay.
insert into private.auth_attempts (key_hash, kind, created_at) values
  (pg_temp.h('old@example.test'), 'otp_request', now() - interval '16 minutes'),
  (pg_temp.h('old@example.test'), 'otp_request', now() - interval '16 minutes'),
  (pg_temp.h('old@example.test'), 'otp_request', now() - interval '16 minutes'),
  (pg_temp.h('stale@example.test'), 'otp_verify', now() - interval '25 hours');

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_request', pg_temp.h('old@example.test'), pg_temp.h('203.0.113.9'))$$,
  $$values (true)$$,
  'attempts older than 15 minutes do not count'
);
reset role;
select is(
  (select count(*) from private.auth_attempts where key_hash = pg_temp.h('stale@example.test')),
  0::bigint, 'rows older than 24 hours are purged by the call itself'
);

-- otp_verify: 5 failures, then a 15-minute block; success resets --------------------------

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select pg_temp.attempts('v', 6, 'otp_verify', 'v@example.test', null);

select results_eq(
  $$select allowed from outcome where label ~ '^v[0-9]' order by label$$,
  $$values (true), (true), (true), (true), (true), (false)$$,
  'the sixth verification after five failures is blocked'
);
select ok(
  (select retry_after between 895 and 900 from outcome where label = 'v06'),
  'the block lasts 15 minutes from the fifth failure'
);
select lives_ok(
  $$select public.rpc_auth_attempt_reset(pg_temp.h('v@example.test'))$$,
  'a successful verification resets the email'
);
select results_eq(
  $$select allowed, retry_after from public.rpc_auth_attempt('otp_verify', pg_temp.h('v@example.test'), null)$$,
  $$values (true, 0)$$,
  'after a reset verification is allowed again'
);
select lives_ok(
  $$select public.rpc_auth_attempt_reset(pg_temp.h('a@example.test'))$$,
  'reset also clears the email''s request counter'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_request', pg_temp.h('a@example.test'), pg_temp.h('203.0.113.10'))$$,
  $$values (true)$$,
  'after a reset the email may request a code again'
);
reset role;

-- Five failures spread over time: blocked until 15 minutes after the fifth.
insert into private.auth_attempts (key_hash, kind, created_at)
select pg_temp.h('w@example.test'), 'otp_verify', now() - make_interval(mins => 15 - n)
from generate_series(1, 5) as n;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select results_eq(
  $$select allowed, retry_after between 295 and 300 from public.rpc_auth_attempt('otp_verify', pg_temp.h('w@example.test'), null)$$,
  $$values (false, true)$$,
  'five failures within 15 minutes block until 15 minutes after the last one'
);

-- Input checks.
select throws_ok(
  $$select * from public.rpc_auth_attempt('otp_request', pg_temp.h('x@example.test'), null)$$,
  '22023', 'invalid_input', 'an OTP request needs the IP hash'
);
select throws_ok(
  $$select * from public.rpc_auth_attempt('otp_verify', '\x0102'::bytea, null)$$,
  '22023', 'invalid_input', 'hashes must be 32 bytes (sha256)'
);
select throws_ok(
  $$select * from public.rpc_auth_attempt('password', pg_temp.h('x@example.test'), pg_temp.h('192.0.2.1'))$$,
  '22023', 'invalid_input', 'unknown kinds are rejected'
);
reset role;

select * from finish();
rollback;
