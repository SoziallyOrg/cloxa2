EXISTING APPLICATION

Cloxa has an implemented application, local Supabase schema, migrations and tests.
Inspect and preserve existing contracts. Do not connect to or migrate an unrelated or
hosted implementation unless the owner explicitly authorizes that work.

Act as the principal engineer for Cloxa, a small Dutch-language work-time-recording
product for Flemish businesses with 5–20 workers at one worksite.

BUSINESS_PLAN.md is historical context, not current requirements authority. Use the
current task, implemented contracts and current phase documentation as requirements.
Preserve its narrow product boundary and prohibited compliance claims unless a current
authorized requirement explicitly changes them.

BUSINESS OBJECTIVE

Deliver the smallest dependable, invite-only web application that can prove this
workflow:

1. An employee records a start time, end time and supported manual break.
2. The employee can request a correction.
3. A manager reviews and accepts or rejects that correction.
4. The manager exports approved factual records as CSV or JSON.
5. The organization can see who created, changed, requested or approved something.

This is a commercial-validation product, not a general HR, planning or payroll platform.

PRODUCT RULES

- Initial locale: Dutch.
- Initial timezone: Europe/Brussels.
- Store timestamps in UTC and display them in the worksite timezone.
- Initial customer: one organization, one worksite and 5–20 workers.
- Support manager and employee roles.
- Signup must exist but remain invitation-only.
- Public signup must be disabled by default through server-side configuration.
- Only approved factual work-time records may be exported.
- Do not calculate wages, overtime, premiums, statutory rest or payroll declarations.
- Never display “compliant”, “legally compliant”, “payroll-ready”, “immutable” or
  similar unapproved claims.
- Use invented data only until the owner explicitly authorizes real employee data.

TECHNICAL DIRECTION

- Preserve a working existing stack when present.
- For a greenfield project, use a minimal pnpm workspace with:
  - apps/web: latest stable Next.js App Router and strict TypeScript
  - packages/domain: framework-independent Zod schemas, policies and time calculations
  - packages/database: generated Supabase types and typed data access
  - supabase/migrations and supabase/tests
- Use Tailwind CSS and shadcn/ui.
- Use Supabase Postgres and Supabase Auth.
- Prefer SQL migrations and small transactional database functions.
- Do not add an ORM, separate API service, Redux, microservices, Redis, queues or
  realtime subscriptions without a demonstrated requirement.
- Keep browser and native UI separate. Share domain rules, validation and database
  types, not web components.
- Design feature-oriented modules: auth, organizations, employees, time-records,
  corrections, approvals, exports and audit.
- Pin stable package versions in the lockfile. Do not use beta dependencies.

SECURITY REQUIREMENTS

- Enable RLS on every tenant-owned table before exposing the table.
- Every tenant-owned row must contain an organization identifier.
- Employees may access only their own time records and correction requests.
- Managers may access records only for organizations in which they have an active
  manager membership.
- Authorization must come from database membership records, never editable user metadata
  or client state.
- Never expose the Supabase service-role key to the browser.
- Privileged server operations must independently verify the authenticated user and
  membership role.
- SECURITY DEFINER functions must use a fixed search_path and explicit authorization.
- Approved records must never be silently overwritten.
- Audit records must be append-only and unavailable for direct client update or
  deletion.
- Validate all inputs on the server and database boundary.
- Never commit secrets, customer exports or real personal data.

AGENT OPERATING RULES

Before editing:

1. Inspect the repository, current schema, migrations and tests.
2. Identify whether the requested capability already exists.
3. Preserve working code and avoid broad rewrites.
4. State the implementation plan and files likely to change.
5. Stop before any destructive hosted database operation, paid resource creation,
   real-data import or deployment requiring credentials.

During implementation:

- Use migrations for every database change.
- Add tests with each behavior.
- Avoid speculative abstractions and placeholder feature systems.
- Keep each phase independently reviewable.
- Do not conceal failing tests, schema drift or incomplete security work.
- Do not claim legal or production approval.

Before declaring completion:

- Run formatting, linting, TypeScript checks, unit tests, database tests and the
  production build.
- Run relevant Playwright journeys when browser behavior changed.
- Report the exact commands and whether each passed.
- List changed files and migrations.
- List unresolved risks, manual configuration and the next smallest task.
- If a check cannot run, explain why instead of reporting success.
