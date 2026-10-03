begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(27);

create function pg_temp.h(p_label text)
returns bytea
language sql
immutable
as $$
  select extensions.digest(p_label, 'sha256');
$$;
grant execute on function pg_temp.h(text) to service_role;

create temporary table outcome (label text, allowed boolean, retry_after integer, paused boolean)
  on commit drop;
grant select, insert on outcome to service_role;

-- p_count calls with the same inputs, recorded as p_label01, p_label02, ...
create function pg_temp.v3(
  p_label text, p_count integer, p_kind text, p_email text, p_ip text, p_subject text
)
returns void
language plpgsql
as $$
begin
  for i in 1..p_count loop
    insert into outcome
    select p_label || lpad(i::text, 3, '0'), attempt.allowed, attempt.retry_after, attempt.paused
    from public.rpc_auth_attempt(
      p_kind,
      case when p_email is null then null else pg_temp.h(p_email) end,
      case when p_ip is null then null else pg_temp.h(p_ip) end,
      case when p_subject is null then null else pg_temp.h(p_subject) end
    ) as attempt;
  end loop;
end;
$$;
grant execute on function pg_temp.v3(text, integer, text, text, text, text) to service_role;

-- A request for p_email from p_ip (the pair hash is h(email || ' ' || ip)).
create function pg_temp.request(p_label text, p_count integer, p_email text, p_ip text)
returns void
language sql
as $$
  select pg_temp.v3(
    p_label, p_count, 'otp_request', p_email, p_ip,
    case when p_ip is null then null else p_email || ' ' || p_ip end
  );
$$;
grant execute on function pg_temp.request(text, integer, text, text) to service_role;

-- Grants ------------------------------------------------------------------------------------

select is(
  array(
    select p.oid::regprocedure::text from pg_catalog.pg_proc as p
    where p.oid in (
      'public.rpc_auth_attempt(text, bytea, bytea, bytea)'::regprocedure,
      'public.rpc_auth_attempt_reset(bytea)'::regprocedure,
      'public.rpc_auth_link_failure(bytea)'::regprocedure
    )
      and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('public', p.oid, 'EXECUTE')
        or not pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ),
  '{}'::text[],
  'the limiter RPCs stay executable by service_role only'
);
select ok(
  not exists (
    select 1 from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and p.proname in ('auth_attempt_v3', 'auth_link_failure', 'auth_global_key')
      and (pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        or pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
  ),
  'the private limiter functions are not executable by API roles'
);
select ok(
  pg_catalog.to_regprocedure('public.rpc_auth_attempt(text, bytea, bytea)') is null,
  'the v1 three-argument entry point is gone'
);

set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000801"}';
select throws_ok(
  $$select public.rpc_auth_link_failure(pg_temp.h('192.0.2.1'))$$,
  '42501', null, 'authenticated cannot record link failures'
);
reset role;
set local role anon;
set local "request.jwt.claims" = '{"role":"anon"}';
select throws_ok(
  $$select * from public.rpc_auth_attempt('link_verify', null, null, null)$$,
  '42501', null, 'anon cannot check links'
);
reset role;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

-- otp_request: 3 per email + IP pair, 10 per email per hour --------------------------------

select pg_temp.request('pa', 4, 'victim@example.test', '203.0.113.66');
select results_eq(
  $$select allowed from outcome where label ~ '^pa' order by label$$,
  $$values (true), (true), (true), (false)$$,
  'a stranger''s IP gets three requests for one address per 15 minutes'
);
select ok(
  (select retry_after between 895 and 900 from outcome where label = 'pa004'),
  'the pair block ends 15 minutes after its oldest request'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt(
      'otp_request', pg_temp.h('victim@example.test'), pg_temp.h('198.51.100.10'),
      pg_temp.h('victim@example.test 198.51.100.10'))$$,
  $$values (true)$$,
  'the real user on another IP can still request a code'
);

-- The email now has 4 recorded requests; six more IPs fill it to 10.
insert into outcome
select 'pe' || lpad(n::text, 3, '0'), attempt.allowed, attempt.retry_after, attempt.paused
from generate_series(1, 7) as n
cross join lateral public.rpc_auth_attempt(
  'otp_request', pg_temp.h('victim@example.test'), pg_temp.h('198.51.100.' || (20 + n)),
  pg_temp.h('victim@example.test 198.51.100.' || (20 + n))
) as attempt;
select is(
  (select count(*) from outcome where label ~ '^pe' and allowed),
  6::bigint, 'an address gets ten requests per hour in total, from any IP'
);
select ok(
  (select not allowed and retry_after between 3500 and 3600 from outcome where label = 'pe007'),
  'the eleventh request within an hour is blocked until the oldest leaves the hour'
);

-- Unknown IP: no shared bucket, only the per-email rule.
insert into outcome
select 'nr' || lpad(n::text, 3, '0'), attempt.allowed, attempt.retry_after, attempt.paused
from generate_series(1, 25) as n
cross join lateral public.rpc_auth_attempt(
  'otp_request', pg_temp.h('nr' || n || '@example.test'), null, null
) as attempt;
select is(
  (select count(*) from outcome where label ~ '^nr' and allowed),
  25::bigint, 'requests without a known IP do not share one IP bucket'
);
select pg_temp.request('ne', 11, 'noip@example.test', null);
select results_eq(
  $$select count(*) filter (where allowed), bool_or(allowed) filter (where label = 'ne011')
    from outcome where label ~ '^ne'$$,
  $$values (10::bigint, false)$$,
  'without an IP the per-email hourly limit still applies'
);

-- otp_verify: no per-email ceiling, no IP cap without an IP -------------------------------

insert into outcome
select 'fv' || lpad(n::text, 3, '0'), attempt.allowed, attempt.retry_after, attempt.paused
from generate_series(1, 25) as n
cross join lateral public.rpc_auth_attempt(
  'otp_verify', pg_temp.h('victim@example.test'), null,
  pg_temp.h('victim@example.test:flow-' || ((n - 1) / 5))
) as attempt;
select is(
  (select count(*) from outcome where label ~ '^fv' and allowed),
  25::bigint, 'five flows of five checks for one address: no per-email ceiling any more'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_verify', pg_temp.h('victim@example.test'), null,
      pg_temp.h('victim@example.test:flow-0'))$$,
  $$values (false)$$,
  'each flow still stops after five checks'
);
insert into outcome
select 'nv' || lpad(n::text, 3, '0'), attempt.allowed, attempt.retry_after, attempt.paused
from generate_series(1, 35) as n
cross join lateral public.rpc_auth_attempt(
  'otp_verify', pg_temp.h('nv' || n || '@example.test'), null, pg_temp.h('nv-flow-' || n)
) as attempt;
select is(
  (select count(*) from outcome where label ~ '^nv' and allowed),
  35::bigint, 'code checks without a known IP skip the IP cap'
);

-- link_verify: a check only; failures are recorded separately -----------------------------

select pg_temp.v3('lc', 40, 'link_verify', null, '198.51.100.40', null);
select is(
  (select count(*) from outcome where label ~ '^lc' and allowed),
  40::bigint, 'checking links records nothing, so successful links never count'
);
reset role;
select is(
  (select count(*) from private.auth_attempts where kind in ('link_verify', 'link_verify_global')),
  0::bigint, 'no link rows exist before any failure'
);

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
do $$ begin perform public.rpc_auth_link_failure(pg_temp.h('198.51.100.41')) from generate_series(1, 29); end $$;
select results_eq(
  $$select allowed, paused from public.rpc_auth_attempt('link_verify', null, pg_temp.h('198.51.100.41'), null)$$,
  $$values (true, false)$$,
  'an IP with 29 failures may still post a link'
);
do $$ begin perform public.rpc_auth_link_failure(pg_temp.h('198.51.100.41')); end $$;
select results_eq(
  $$select allowed, retry_after between 895 and 900, paused
    from public.rpc_auth_attempt('link_verify', null, pg_temp.h('198.51.100.41'), null)$$,
  $$values (false, true, false)$$,
  'after 30 failures in 15 minutes the IP is blocked (not paused for everyone)'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('link_verify', null, pg_temp.h('198.51.100.42'), null)$$,
  $$values (true)$$,
  'another IP may still post links'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('link_verify', null, null, null)$$,
  $$values (true)$$,
  'a client without a known IP skips the IP rule'
);

-- Global ceiling: 300 failures per 10 minutes pause link sign-in for everyone.
do $$ begin perform public.rpc_auth_link_failure(null) from generate_series(1, 269); end $$;
select results_eq(
  $$select allowed, paused from public.rpc_auth_attempt('link_verify', null, pg_temp.h('198.51.100.43'), null)$$,
  $$values (true, false)$$,
  '299 failures overall still allow links'
);
do $$ begin perform public.rpc_auth_link_failure(null); end $$;
select results_eq(
  $$select allowed, retry_after between 595 and 600, paused
    from public.rpc_auth_attempt('link_verify', null, pg_temp.h('198.51.100.43'), null)$$,
  $$values (false, true, true)$$,
  'the 300th failure pauses link sign-in for 10 minutes'
);
select results_eq(
  $$select allowed, paused from public.rpc_auth_attempt('link_verify', null, null, null)$$,
  $$values (false, true)$$,
  'the pause also applies to clients without a known IP'
);
reset role;
select is(
  (select count(*) from private.auth_attempts where kind = 'link_verify'),
  30::bigint, 'IP-less failures record only the global row'
);

-- Input checks ------------------------------------------------------------------------------

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select * from public.rpc_auth_attempt('otp_request', pg_temp.h('x@example.test'), pg_temp.h('192.0.2.1'), null)$$,
  '22023', 'invalid_input', 'a request with a known IP needs the email + IP pair'
);
select throws_ok(
  $$select * from public.rpc_auth_attempt('otp_verify', pg_temp.h('x@example.test'), null, null)$$,
  '22023', 'invalid_input', 'a code check needs its flow'
);
reset role;

select * from finish();
rollback;
