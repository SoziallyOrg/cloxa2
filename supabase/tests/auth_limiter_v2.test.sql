begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;
set local "request.jwt.claim.sub" = '';

select plan(14);

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

-- p_count calls of the v2 RPC with the same inputs, recorded as p_label01, p_label02, ...
create function pg_temp.v2(
  p_label text, p_count integer, p_kind text, p_email text, p_ip text, p_subject text
)
returns void
language plpgsql
as $$
begin
  for i in 1..p_count loop
    insert into outcome
    select p_label || lpad(i::text, 2, '0'), attempt.allowed, attempt.retry_after
    from public.rpc_auth_attempt(
      p_kind,
      case when p_email is null then null else pg_temp.h(p_email) end,
      case when p_ip is null then null else pg_temp.h(p_ip) end,
      case when p_subject is null then null else pg_temp.h(p_subject) end
    ) as attempt;
  end loop;
end;
$$;
grant execute on function pg_temp.v2(text, integer, text, text, text, text) to service_role;

-- Grants ------------------------------------------------------------------------------------

select ok(
  pg_catalog.has_function_privilege('service_role', 'public.rpc_auth_attempt(text, bytea, bytea, bytea)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('authenticated', 'public.rpc_auth_attempt(text, bytea, bytea, bytea)', 'EXECUTE')
    and not pg_catalog.has_function_privilege('anon', 'public.rpc_auth_attempt(text, bytea, bytea, bytea)', 'EXECUTE'),
  'the limiter is executable by service_role only'
);

set local role authenticated;
set local "request.jwt.claims" = '{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000701"}';
select throws_ok(
  $$select * from public.rpc_auth_attempt('totp_verify', null, null, pg_temp.h('user'))$$,
  '42501', null, 'authenticated cannot record attempts'
);
reset role;

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';

-- otp_verify: the tight limit is per flow, not per email ---------------------------------

select pg_temp.v2('fa', 6, 'otp_verify', 'victim@example.test', null, 'victim@example.test:flow-a');
select results_eq(
  $$select allowed from outcome where label ~ '^fa[0-9]' order by label$$,
  $$values (true), (true), (true), (true), (true), (false)$$,
  'the sixth verification in one flow is blocked'
);
select ok(
  (select retry_after between 895 and 900 from outcome where label = 'fa06'),
  'a blocked flow waits 15 minutes from its fifth failure'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_verify', pg_temp.h('victim@example.test'), null, pg_temp.h('victim@example.test:flow-b'))$$,
  $$values (true)$$,
  'a new login flow for the same email is not locked out by failures elsewhere'
);

-- (The v2 per-email ceiling was removed in v3; see auth_limiter_v3.test.sql.)

-- IP cap: 30 verifications per 15 minutes, whatever the email.
insert into outcome
select 'ip' || lpad(n::text, 2, '0'), attempt.allowed, attempt.retry_after
from generate_series(1, 31) as n
cross join lateral public.rpc_auth_attempt(
  'otp_verify', pg_temp.h('ip' || n || '@example.test'), pg_temp.h('192.0.2.50'), pg_temp.h('flow-' || n)
) as attempt;
select is(
  (select count(*) from outcome where label ~ '^ip' and allowed),
  30::bigint, 'an IP gets 30 verifications per 15 minutes'
);
select ok(
  (select not allowed and retry_after > 0 from outcome where label = 'ip31'),
  'the 31st verification from one IP is blocked'
);

-- (link_verify counts failures only since v3; see auth_limiter_v3.test.sql.)

-- totp_verify: per user, 5 failures then a 15-minute block --------------------------------

select pg_temp.v2('tt', 6, 'totp_verify', null, null, 'user-1');
select results_eq(
  $$select allowed from outcome where label ~ '^tt' order by label$$,
  $$values (true), (true), (true), (true), (true), (false)$$,
  'the sixth TOTP check for one user is blocked'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('otp_verify', pg_temp.h('user-1'), null, pg_temp.h('user-1:flow'))$$,
  $$values (true)$$,
  'TOTP failures never count against the email code limits'
);
select lives_ok(
  $$select public.rpc_auth_attempt_reset(pg_temp.h('user-1'))$$,
  'a successful TOTP check resets the user'
);
select results_eq(
  $$select allowed from public.rpc_auth_attempt('totp_verify', null, null, pg_temp.h('user-1'))$$,
  $$values (true)$$,
  'after a reset TOTP checks are allowed again'
);
reset role;

select is(
  (select count(*) from private.auth_attempts where key_hash = pg_temp.h('victim@example.test:flow-a')),
  5::bigint, 'blocked attempts are not recorded'
);

-- Input checks ------------------------------------------------------------------------------

set local role service_role;
set local "request.jwt.claims" = '{"role":"service_role"}';
select throws_ok(
  $$select * from public.rpc_auth_attempt('link_verify', pg_temp.h('x@example.test'), pg_temp.h('192.0.2.1'), null)$$,
  '22023', 'invalid_input', 'a link check is keyed on the IP only'
);
select throws_ok(
  $$select * from public.rpc_auth_attempt('totp_verify', pg_temp.h('x@example.test'), null, pg_temp.h('user'))$$,
  '22023', 'invalid_input', 'a TOTP check never carries the email'
);
reset role;

select * from finish();
rollback;
