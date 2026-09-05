# Phase 11A status: manager TOTP MFA

## Scope

Branch `feat/manager-totp-mfa` started from required base
`c9e522eca3510641ccdec93272842c7e1310af02`. Work is limited to native Supabase TOTP MFA
for manager access, application/database enforcement, synthetic local verification, and
documentation. No hosted Supabase access, deploy, merge, billing, analytics, or complete
production recovery process.

## Delivered design

- Native provider enrollment, challenge, verification, and AAL2 session update.
- Dutch setup, routine verification, and administrator-recovery-required pages.
- Exact allowlisted return paths; no browser-selected factor during routine login.
- Private application registration stores user, provider factor ID, and timestamp only.
- Shared database assurance binds live session, AAL2, TOTP AMR, verified factor,
  registration, manager membership, tenant lifecycle, user state, and expiry.
- Manager RLS, RPCs, invitations, corrections, breaks, team settings, exports, and both
  download routes fail closed without full assurance. Employees remain unchanged.
- Advisory-locked first-factor registration, same-factor retry, competing-factor
  rejection, minimal one-time audit, and persistent recovery state after factor loss.

## Verification evidence

| Gate                             | Result                                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| Migration reset                  | Passed from clean local database through all 12 migrations             |
| Focused pgTAP                    | 223 assertions passed                                                  |
| Full pgTAP                       | 13 files, 1,697 assertions passed twice consecutively                  |
| Unit/integration                 | 46 files, 1,001 tests passed                                           |
| TypeScript                       | All three workspaces passed                                            |
| ESLint and Prettier              | Passed with zero warnings; all files formatted                         |
| Native local Auth browser tests  | 4/4 passed across desktop and exact 320px                              |
| Full production browser suite    | 87 passed, 3 intentional project skips, 0 failed                       |
| Production build and bundle scan | Passed; 21 page-generation tasks and 26 browser bundles, no server key |
| Database types and schema lint   | Generated types current; no schema warnings                            |
| Production dependency audit      | No known vulnerabilities                                               |
| GitHub CI                        | Required on draft PR final head; result reported in delivery           |

Delivery reports final tested commit and CI run URL because GitHub creates run identity
only after commit and push.

## Known boundary

Factor loss enters explicit blocked recovery route. Phase 11A does not provide
self-service factor replacement, backup codes, administrator console, identity-proofing
procedure, hosted incident runbook, or claim of production recovery readiness.

# Phase 11B status: controlled local manager MFA recovery

## Scope

Branch `feat/local-manager-mfa-recovery` starts from required base
`81c6c43168cff12042e61e945839492fc7dc7ce6`. Work is limited to one explicitly confirmed
synthetic local manager, native Supabase factor administration, protected replacement
enrollment, database-enforced session cutoff, deferred native password-reset regression,
and documentation. No hosted Supabase access, deployment, merge, generic user editor,
production identity proofing, or support-authorization workflow.

## Delivered design

- Fixed `start`/`status`/`complete` operator CLI with exact UUID confirmations and
  fail-closed repository stack validation.
- Database recovery denial committed before native Admin API factor removal.
- Native factor inspection and exact registered TOTP deletion; unrelated or unexpected
  factor state stops for operator review.
- Fifteen-minute server-timestamped cases, one unresolved case per manager, preserved
  terminal history, prior binding snapshot, and exact operation replay.
- Browser candidate creation derives authenticated user, live session, native AAL2,
  matching session factor, verified TOTP ownership, and AMR. Candidate never grants
  business access.
- Exact operator-selected candidate completion revalidates locked case, binding, factor,
  provider removal, session, evidence, and deadline in one transaction with audit.
- Authoritative `auth.sessions.created_at` cutoff blocks all pre-completion sessions and
  refresh tokens. Fresh login plus replacement-factor verification restores access.
- Explicit `local_operator` audit actor without fabricated manager session. Events
  contain only start state/window and completion state/factor type/generation.
- Dutch no-store recovery UI exposes enrollment QR/manual key only while needed and
  shows non-secret candidate reference while awaiting approval.
- Registered-manager password reset requires native verification of exact bound factor;
  missing-factor path remains blocked. Successful reset performs global Auth sign-out.

## Verification evidence

| Gate                             | Result                                                                 |
| -------------------------------- | ---------------------------------------------------------------------- |
| Migration reset                  | Passed from clean local database through all 13 migrations             |
| Focused recovery/assurance pgTAP | 66 recovery and 48 assurance assertions passed                         |
| Full pgTAP                       | 14 files; clean run 1,751 plus 12 focused privilege/factor assertions  |
| Unit/integration                 | 47 files, 1,014 tests passed                                           |
| TypeScript, ESLint and Prettier  | All workspaces passed; zero lint warnings; all files formatted         |
| Native local Auth recovery suite | 8/8 passed across desktop and exact 320px                              |
| Full production browser suite    | 91 passed, 3 intentional project skips, 0 failed                       |
| Production build and bundle scan | Passed; 20 page-generation tasks and 27 browser bundles, no server key |
| Database types and schema lint   | Generated types current; no schema warnings                            |
| Production dependency audit      | No known vulnerabilities                                               |
| GitHub CI                        | Required on draft PR final head; result reported in delivery           |

Final tested commit and CI run URL are reported in delivery because GitHub creates run
identity only after commit and push.

## Known boundary

Recovery trust is local operator control of this checkout, ignored fictional
credentials, local Docker stack, and direct local Postgres maintenance channel. Native
factor deletion and database completion cannot share a transaction; persistent recovery
denial is the authorization boundary. Production identity proofing, hosted support
authorization, hosted recovery, backup codes, and database-administrator compromise
protection remain unimplemented.
