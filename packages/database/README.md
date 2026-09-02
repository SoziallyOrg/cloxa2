# `@cloxa/database`

This package exports TypeScript types generated from the local Supabase `public` schema.
Do not hand-edit `src/database.types.ts` or maintain duplicate database interfaces.
Next.js request clients stay in `apps/web` because they depend on request cookies.

Start the local stack before running database commands:

```bash
pnpm supabase:start
pnpm supabase:status
```

Create and inspect versioned migrations:

```bash
pnpm exec supabase migration new <descriptive_name>
pnpm exec supabase migration list --local
```

Rebuild, test, lint, and generate types from the local database:

```bash
pnpm supabase:reset
pnpm test:db
pnpm supabase:lint
pnpm supabase:types
pnpm supabase:types:check
```

Type generation passes CLI output through the repository Prettier configuration before
writing `src/database.types.ts`. The check command regenerates the same output in memory
and fails when the stored types differ.

## Authorization and invitation authentication

`public.memberships` is the authoritative source for organization roles. Authorization
helpers derive identity from `auth.uid()` and require an active membership in an
organization whose lifecycle is `research_pilot` or `paid_beta`. They do not trust
metadata, email addresses, route names, or browser state as proof of tenant access.

All six application tables have RLS enabled. This matrix describes direct access through
`anon` and `authenticated` database roles:

| Table           | Anonymous | Active employee               | Active manager                                                                                    | Invited, inactive, absent membership, or suspended organization | Direct browser writes                                                                                      |
| --------------- | --------- | ----------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `profiles`      | None      | Own profile                   | Own profile and profiles of members in manager's organization, including invited/inactive members | Own profile                                                     | Authenticated owner may update `display_name` and `locale`; no insert/delete or identity/timestamp changes |
| `organizations` | None      | Own organization              | Own organization                                                                                  | None                                                            | None                                                                                                       |
| `worksites`     | None      | Worksites in own organization | Worksites in own organization                                                                     | None                                                            | None                                                                                                       |
| `memberships`   | None      | Own active membership         | Memberships in own organization, including invited/inactive members                               | None, including own membership                                  | None                                                                                                       |
| `invitations`   | None      | None                          | Invitations in own organization                                                                   | None                                                            | None                                                                                                       |
| `audit_events`  | None      | None                          | Events in own organization                                                                        | None                                                            | None                                                                                                       |

Access applies per organization: losing access to one tenant does not remove a user's
separate active membership in another tenant. Suspension removes access to all rows
scoped to that organization. Users retain their own profile read/update permission
without active tenant access. Managers cannot edit another user's profile or change
roles, membership status, tenant assignment, or invitations through direct table writes.

`private.is_active_org_member(uuid)`, `private.has_org_role(uuid, text)`, and
`private.can_read_member_profile(uuid)` avoid recursive membership policies. These
`SECURITY DEFINER` helpers use a fixed empty `search_path`, schema-qualified references,
and the current authenticated identity. Only `authenticated` receives execution grants;
the `private` schema remains outside the API's exposed schemas.

All private functions have owner `postgres` and fixed `search_path = ''`:

| Function                        | Security | Application-role EXECUTE |
| ------------------------------- | -------- | ------------------------ |
| `is_active_org_member`          | DEFINER  | `authenticated`          |
| `has_org_role`                  | DEFINER  | `authenticated`          |
| `can_read_member_profile`       | DEFINER  | `authenticated`          |
| `set_updated_at`                | INVOKER  | None                     |
| `normalize_invitation_email`    | INVOKER  | None                     |
| `reject_audit_event_mutation`   | INVOKER  | None                     |
| `get_auth_context`              | DEFINER  | `authenticated`          |
| `create_employee_invitation`    | DEFINER  | `authenticated`          |
| `get_employee_invitation_state` | DEFINER  | `authenticated`          |
| `accept_employee_invitation`    | DEFINER  | `authenticated`          |

The owner retains EXECUTE; `PUBLIC`, `anon`, and `service_role` have no EXECUTE grants.
Authenticated SQL callers can invoke authorization and invitation helpers through four
`SECURITY INVOKER` wrappers in `public`. Their definer implementations stay in the
unexposed `private` schema. Every protected helper binds identity to `auth.uid()` and a
matching live `auth.sessions` row. Trigger functions have no application EXECUTE grants.
Neither `anon` nor `service_role` can call the new RPCs.

| Public RPC                                                                  | Browser inputs                             | Result                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `get_auth_context()`                                                        | None                                       | One `authorized`, `unauthorized`, or `unsupported` row; tenant and role appear only for one active membership in an active organization |
| `create_employee_invitation(employee_email, display_name?, employee_code?)` | Employee email and optional profile fields | New invitation ID or a non-disclosing `NULL` duplicate/no-op                                                                            |
| `get_employee_invitation_state()`                                           | None                                       | `ready`, `unavailable`, or `unsupported` for current verified Auth email                                                                |
| `accept_employee_invitation()`                                              | None                                       | Activated employee membership ID                                                                                                        |

Creation derives organization from caller's sole active manager membership, fixes role
to `employee`, normalizes email, expires invitations after 24 hours, and appends a
minimal creation audit. Acceptance requires a verified Auth email, password marker, live
matching session, one usable invitation, and no active membership. It creates or
preserves the profile, activates exactly one employee membership, marks invitation
accepted, and appends acceptance audit in one database transaction. Advisory and row
locks serialize competing operations. Browser callers cannot provide organization, role,
status, user, worksite, invitation ID, or expiry.

For `audit_events`, both `authenticated` and `service_role` have SELECT-only table
privileges. RLS limits authenticated reads to active managers in their own non-suspended
organizations. Employees and inactive or suspended-organization managers receive no
rows; `anon` has no SELECT privilege. Service-role clients bypass RLS and can read audit
rows across organizations, so keep them server-only. Service-role grants on the other
five tables permit controlled writes.

Neither browser roles nor `service_role` can INSERT, UPDATE, DELETE, or TRUNCATE audit
events. Row-level BEFORE UPDATE/DELETE and statement-level BEFORE TRUNCATE triggers use
`private.reject_audit_event_mutation()` to reject those mutations even for an owner SQL
statement. TRUNCATE needs its own guard because it ignores RLS and DELETE triggers.
Database owners can still alter or disable triggers; these guards are not tamper-proof
storage.

Invitation functions authenticate caller, check protected membership state, and append
audit events with authorized business changes in one transaction. Application roles
still receive no direct table INSERT privilege and no general audit-write RPC. Local
manager bootstrap uses a server-side secret client against a verified loopback stack; it
does not expose a database bootstrap endpoint. Audits contain no emails, profile fields,
secrets, authentication tokens, or links.

Profile UPDATE privileges cover `display_name` and `locale` only, with RLS checking
`user_id = auth.uid()` before and after each update. Callers cannot write `user_id`,
`created_at`, or `updated_at`; the trusted trigger sets `updated_at` to the statement
timestamp. Profiles contain no organization, membership, role, or status fields, and
profile text does not grant authorization.

## Schema decisions and limits

- Organization foreign keys use `ON DELETE RESTRICT`, including audit history.
  Membership users, invitation senders and accepters, and audit actors also use
  `RESTRICT`. A future controlled deletion process must address those references;
  deleting a user or tenant must not erase audit history through a cascade.
- Profiles use `ON DELETE CASCADE` from `auth.users`. Other references can still block
  user deletion. Profile cleanup does not constitute a complete retention or erasure
  workflow.
- Invitation writes normalize surrounding spaces and letter case with
  `lower(btrim(normalized_email))`. A partial unique index permits one `pending`
  invitation per organization and normalized email. It does not merge provider-specific
  aliases such as plus-addresses.
- Passing `expires_at` does not change `pending` status or free that unique slot. The
  trusted creation RPC expires a stale invitation in caller's tenant before replacing
  it. No background expiry scheduler exists.
- `intended_role` permits `employee` only. Acceptance verifies current Auth user email
  against normalized invitation email. Manager creation remains a separate controlled
  local-development operation.
- Invitation constraints require expiry after creation and consistent status fields:
  `pending`/`expired` have no acceptance or revocation data; `accepted` requires an
  accepter and acceptance time from creation until before expiry, with no revocation;
  `revoked` requires revocation at or after creation, with no acceptance data. These
  checks validate stored rows; they do not implement status-transition authorization.
- Profile locale defaults to `nl-BE` and currently permits only `nl-BE`. Worksite
  timezone defaults to `Europe/Brussels`. Timestamps use `timestamptz`; mutable tables
  maintain `updated_at` through database triggers.
- Schema permits multiple worksites per organization for future use. Pilot application
  must expose one worksite; Phase 1 adds no worksite-management UI.

Hosted Supabase connections, deployment, paid resources, and real personal or customer
data remain prohibited. Development and tests use local synthetic data only. This phase
does not establish production readiness or implement time records, corrections,
approvals, exports, billing, or product dashboards.

Next phase: employee clock-in and clock-out.
