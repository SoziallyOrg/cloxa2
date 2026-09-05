# Manager TOTP MFA contract

## Trust boundary

Supabase Auth owns TOTP secrets, challenges, codes, factor verification, session AAL,
and AMR. Cloxa stores only factor binding, generation, database timestamps, and private
recovery evidence. Browser roles have no table privileges or policies on registration,
case, or candidate tables. No application table or audit stores provider secret, code,
challenge, access token, refresh token, QR payload, email, or raw session identifier.

## Manager assurance

`private.manager_assurance_context()` returns one row only when all conditions hold:

- effective role and JWT role are `authenticated`;
- `auth.uid()` resolves confirmed, nonanonymous, nondeleted, nonbanned Auth user;
- exactly one active membership exists and it is manager in active pilot/beta tenant;
- JWT session ID matches live nonexpired `auth.sessions` row for user;
- JWT and live session both report AAL2;
- live session factor ID equals application registration;
- matching Auth factor belongs to user, has type `totp`, and remains `verified`;
- live session AMR row and JWT AMR both contain `totp`;
- no unresolved recovery case exists;
- live provider session was created after any recovery completion cutoff;
- numeric JWT expiry, when present, remains in future.

Manager RLS helpers, correction review, break review, exports, team administration,
settings, invitations, audit reads, and download snapshot RPCs depend on this context.
Employee branches of shared RLS helpers retain prior checks.

## Status and application routes

`get_manager_mfa_status()` returns one state:

- `setup`: authorized manager has no application registration;
- `verify`: registered verified factor exists, but current session lacks complete AAL2
  assurance; factor ID is returned only for this state;
- `ready`: all assurance conditions hold; factor ID is omitted;
- `recovery_required`: registration is missing from provider or recovery is unresolved.
  Nested recovery state distinguishes operator action, active enrollment, verified
  candidate awaiting approval, expiration, and completed recovery requiring fresh login;
- `denied`: base membership authorization is not one active manager membership.

Next.js maps states to `/manager/security/setup`, `/manager/security/verify`, and
`/manager/security/recovery-required`. Only exact manager page allowlist may pass
through `volgende`. Security pages fetch no organization data. Download routes return
403 before snapshot access unless state is authorized manager.

## Registration

`register_manager_mfa()` accepts no browser identifiers. It derives factor from live
verified AAL2 session, locks by user advisory namespace, rechecks Auth/session/factor/
membership/tenant rows, then inserts registration. First factor wins. Same-factor retry
returns `ready` without second audit. Different verified factor raises
`manager_mfa_recovery_required`; it cannot replace row.

Any recovery history permanently disables ordinary initial-registration fallback for
that manager. Recovery never deletes registration to reopen setup. Successful first
registration appends one `manager_mfa.registered` audit with only
`{"state":"registered","factor_type":"totp"}`.

## Controlled local recovery

Phase 11B adds local-development recovery for one explicitly selected synthetic manager.
Production identity proofing, hosted support authorization, and self-service reset
remain outside Phase 11B. Fixed ceremony:

1. Local operator starts a 15-minute case. Database denial exists before provider
   change.
2. CLI inspects native factors and removes only exact registered verified TOTP through
   Supabase Auth Admin API.
3. Manager signs in and enrolls/verifies replacement through native MFA during window.
4. Database records candidate from authenticated live session, native AAL2, matching
   session factor, TOTP AMR, and verified-factor ownership. Browser supplies case ID
   only.
5. UI shows candidate reference, but candidate grants no business access.
6. Operator completes with exact user, case, candidate, operation, and confirmations.
7. One locked transaction revalidates old binding, candidate, factor, session, deadline,
   and provider removal; advances generation; changes binding; records cutoff; closes
   case; and appends minimal completion audit.
8. Candidate and every older session stay denied. Fresh password login followed by
   replacement-factor verification is required.

Cases preserve prior factor, generation, registration timestamp, attempts, outcomes,
candidate evidence, and terminal state. Database permits one unresolved case per
manager. Expiry preserves denial and history; another explicit start is required. Start
and complete operation IDs provide exact replay, while altered reuse fails.

### Local operator commands

Commands require ignored local credentials, exact repository project `cloxa2`, expected
ports, literal loopback endpoints, no hosted link, running matching stack, fictional
manager marker, and matching confirmation values. Output excludes credentials, tokens,
passwords, OTPs, enrollment secrets, factor IDs, and session IDs.

```bash
pnpm local:manager-mfa-recovery start --target-user <user-uuid> --operation-id <operation-uuid> --confirm-local-development --confirm-target <same-user-uuid>
pnpm local:manager-mfa-recovery status --target-user <user-uuid> --case-id <case-uuid> --confirm-local-development --confirm-target <same-user-uuid> --confirm-case <same-case-uuid>
pnpm local:manager-mfa-recovery complete --target-user <user-uuid> --case-id <case-uuid> --candidate-id <candidate-uuid> --operation-id <operation-uuid> --confirm-local-development --confirm-target <same-user-uuid> --confirm-case <same-case-uuid> --confirm-candidate <same-candidate-uuid>
```

`start` commits denial before native deletion. Provider failure leaves case blocked and
records failed attempt. Exact retry first inspects actual factors, so lost delete
response can resume safely. Unexpected, multiple, non-TOTP, or unrelated factors stop
for review; CLI never deletes them. `status` lists non-secret candidate references for
selection. `complete` never changes provider state and never reports success unless
binding and audit commit together.

Maintenance functions are direct-local-Postgres only and reject any `session_user` other
than `postgres`. PUBLIC, `anon`, `authenticated`, and `service_role` receive no function
or table privilege. Web app has no privileged recovery endpoint and imports no service
credential into client code. Native factor deletion and database transaction cannot be
atomic; persistent database denial is authorization boundary.

## Password recovery

Recovery-link proof alone cannot reset password for registered manager. Manager must
verify exact registered factor through native MFA first; missing factor remains blocked
and points to controlled recovery. Successful manager reset performs global native
sign-out and returns to login. Employee recovery retains existing behavior.

## Tests

`supabase/tests/manager_mfa_assurance.test.sql` covers schema privileges, AAL1 direct
reads and RPC/download denial, metadata forgery, registration, idempotency, audit,
password-recovery AAL1, refreshed AAL2, different-factor collision, factor
unverification/removal, and persistent recovery state. Existing manager pgTAP fixtures
carry synthetic provider-equivalent evidence so every older authorization and mutation
test continues through same assurance gate.

`supabase/tests/manager_mfa_recovery.test.sql` covers case privilege boundaries,
pre-removal denial, operation replay, provider failure, candidate derivation, cross-user
and stale rejection, atomic completion/audit rollback, preserved binding history,
expiration, refreshed old-session denial, and required post-cutoff login.

`tests/local-manager-mfa-recovery.test.ts` covers CLI confirmations, local-stack
validation, fixed maintenance calls, provider response-loss retry, and unexpected factor
failure. Web action tests cover recovery candidate recording and manager password-reset
MFA gate.

`apps/web/e2e/manager-mfa.spec.mts` uses disposable local users and native Supabase Auth
enrollment/challenge/verification. It covers desktop and exact 320px flows, direct Data
API/RPC/download denial, invalid and valid code behavior, routine login, factor removal,
simultaneous setup attempts, native recovery, password-reset regression, old
refresh-token denial, fresh-login restoration, and concurrent operator replay.
Playwright trace, screenshots, and video remain off so secrets never enter artifacts.
