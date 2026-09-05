# Manager TOTP MFA contract

## Trust boundary

Supabase Auth owns TOTP secrets, challenges, codes, factor verification, session AAL,
and AMR. Cloxa stores only `auth_user_id`, `provider_factor_id`, and database-controlled
`registered_at` in `private.manager_mfa_registrations`. Browser roles have no table
privileges or policy on that table. No application table or audit stores provider
secret, code, challenge, access token, or QR payload.

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
- numeric JWT expiry, when present, remains in future.

Manager RLS helpers, correction review, break review, exports, team administration,
settings, invitations, audit reads, and download snapshot RPCs depend on this context.
Employee branches of shared RLS helpers retain prior checks.

## Status and application routes

`get_manager_mfa_status()` returns exactly one state:

- `setup`: authorized manager has no application registration;
- `verify`: registered verified factor exists, but current session lacks complete AAL2
  assurance; factor ID is returned only for this state;
- `ready`: all assurance conditions hold; factor ID is omitted;
- `recovery_required`: registration exists but provider factor is missing or not
  verified;
- `denied`: base membership authorization is not one active manager membership.

Next.js maps states to `/manager/security/setup`, `/manager/security/verify`, and
`/manager/security/recovery-required`. Only exact manager page allowlist may pass
through `volgende`. Security pages fetch no organization data. Download routes return
403 before snapshot access unless state is authorized manager.

## Registration and recovery

`register_manager_mfa()` accepts no browser identifiers. It derives factor from live
verified AAL2 session, locks by user advisory namespace, rechecks Auth/session/factor/
membership/tenant rows, then inserts registration. First factor wins. Same-factor retry
returns `ready` without second audit. Different verified factor raises
`manager_mfa_recovery_required`; it cannot replace row.

Successful first registration appends one `manager_mfa.registered` audit with only
`{"state":"registered","factor_type":"totp"}`. Factor removal or unverification does not
delete registration. Phase 11A provides honest administrator-recovery-required UI, not
self-service replacement or full production recovery process.

## Tests

`supabase/tests/manager_mfa_assurance.test.sql` covers schema privileges, AAL1 direct
reads and RPC/download denial, metadata forgery, registration, idempotency, audit,
password-recovery AAL1, refreshed AAL2, different-factor collision, factor
unverification/removal, and persistent recovery state. Existing manager pgTAP fixtures
carry synthetic provider-equivalent evidence so every older authorization and mutation
test continues through same assurance gate.

`apps/web/e2e/manager-mfa.spec.mts` uses disposable local users and native Supabase Auth
enrollment/challenge/verification. It covers desktop and exact 320px flows, direct Data
API/RPC/download denial, invalid and valid code behavior, routine login, factor removal,
and simultaneous setup attempts. Playwright trace, screenshots, and video remain off so
secrets never enter artifacts.
