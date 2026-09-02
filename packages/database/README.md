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

## Phase 1 authorization

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

All six private functions have owner `postgres` and fixed `search_path = ''`:

| Function                      | Security | Application-role EXECUTE |
| ----------------------------- | -------- | ------------------------ |
| `is_active_org_member`        | DEFINER  | `authenticated`          |
| `has_org_role`                | DEFINER  | `authenticated`          |
| `can_read_member_profile`     | DEFINER  | `authenticated`          |
| `set_updated_at`              | INVOKER  | None                     |
| `normalize_invitation_email`  | INVOKER  | None                     |
| `reject_audit_event_mutation` | INVOKER  | None                     |

The owner retains EXECUTE; `PUBLIC`, `anon`, and `service_role` have no EXECUTE grants.
Authenticated SQL callers can invoke the three authorization helpers. Their definer
context bypasses membership RLS to avoid recursion, but each helper binds its check to
`auth.uid()` and returns a boolean for that caller's access. No helper accepts a caller
identity override or writes data. Trigger functions have no application EXECUTE grants,
and none of these private functions have Data API endpoints.

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

Future controlled transactional database functions must authenticate the caller, check
protected memberships, and append audit events with the authorized business change in
one transaction. Phase 1 grants no application role INSERT and adds no audit-write RPC
or organization-bootstrap endpoint. Keep secrets, authentication tokens, and exported
files out of audit JSON.

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
- Passing `expires_at` does not change `pending` status or free that unique slot. Future
  trusted invitation operations must reject expired acceptance and mark stale pending
  invitations `expired` or `revoked` before issuing a replacement. Phase 1 adds no
  expiry scheduler, email delivery, acceptance workflow, or reusable invitation token.
- `intended_role` permits `employee` only. Future acceptance must verify authenticated
  email against normalized invitation email. Manager creation remains a separate
  controlled operation.
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

Invitation-based authentication and controlled local test-user creation remain outside
Phase 1.
