# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js App Router in a pnpm workspace, strict TypeScript, Tailwind CSS, shadcn/ui,
Supabase Postgres and Auth through `@supabase/ssr`, Zod, Vitest, Playwright, ESLint, and
Prettier. User selected this stack. Redux Toolkit is excluded because the brief
separately forbids Redux; no replacement client state library is assumed.

## Users

- Dutch-speaking employees at one Flemish worksite who record and review their own
  factual work-time entries.
- One Dutch-speaking manager who reviews corrections and creates confirmed factual
  CSV/JSON snapshots for a payroll-preparation role.
- First customer profile: one organization, one worksite, 5–20 workers.

## Product Purpose

Cloxa will reduce time spent collecting, correcting, approving, and handing off factual
work-time records while preserving a visible history of changes. Current pilot scope
supports invitation authentication, employee clock-in/out, employee correction requests,
manager approval/rejection with controlled factual application, live unpaid breaks, and
manager-confirmed factual CSV/JSON snapshots.

## Positioning

Cloxa centers a reviewable correction chain for one small Flemish team. It does not
calculate wages, overtime, premiums, statutory rest, declarations, or sector-specific
rules, and it must not be presented as payroll or compliance software.

## Operating Context

Employees primarily use a mobile browser at or around work. A manager reviews records
and confirms fixed factual snapshots for CSV or JSON in a browser. Research pilots, if
authorized later, run beside the customer’s existing official process.

## Capabilities and Constraints

- Implemented workflow: invitation, login, secure employee clock-in/out, today's own
  factual registrations, employee adjustment or missed-entry requests, manager review,
  employee visibility of final decisions and explanations, export preview/blockers,
  explicit snapshot confirmation, deterministic CSV/JSON download, and recent history.
- Approval applies the employee's exact interval atomically. Rejection preserves facts.
  Immutable claims, versioned factual records, and append-only audits preserve history.
- Export confirmation approves only exact factual versions captured in that snapshot.
  Later fact/profile/code changes require a new export and do not rewrite prior rows.
- Live unpaid breaks use server start/end timestamps on the employee's open shift.
  Clock-out requires ending the current break first. Gross, completed-break, and net
  durations preserve exact microseconds; open intervals have no invented end.
- Adjustment submission and approval must contain every recorded break. Conflicting
  approval stays pending and does not modify facts or append approval audits.
- New v1 exports intentionally block break-bearing facts until a separately reviewed v2.
  Existing v1 snapshots keep their original bytes, hashes, and download authorization.
- Breaks are factual unpaid intervals, not statutory-rest or payroll calculations.
  Manual historical breaks and break correction requests remain unimplemented.
- Public signup and automatic billing remain disabled.
- No historical break creation, break corrections, direct manual factual entries,
  scheduled exports, delivery integration, payroll calculations, billing, realtime,
  native app, ORM, Redux, Redis, queues, storage, analytics, microservices, or offline
  service worker.
- Hosted Supabase access, real employee data, customer outreach, spending, and
  deployment are out of scope.
- One organization and one worksite remain explicit pilot constraints.

## Brand Commitments

Name: Cloxa. Interface language: Dutch, with copy centralized so English can be added
later. Voice: direct, calm, factual, and careful about unproven legal, payroll,
security, and commercial claims. No logo or other visual asset has been provided.

## Evidence on Hand

`BUSINESS_PLAN.md` is product and commercial source material. No users, customer data,
testimonials, production metrics, deployed product, approved compliance claim, or
incumbent interface exists. Future work must not fabricate them.

## Product Principles

1. Preserve factual history instead of silently replacing approved records.
2. Keep first workflow narrow enough for one small team to understand quickly.
3. Default to invite-only access and least-privilege server boundaries.
4. Separate demonstrated product behavior from hypotheses and future work.
5. Make common employee actions usable on a small mobile screen.

## Accessibility & Inclusion

Assumption derived from accessible-state requirement: target WCAG 2.2 AA, keyboard
operation, visible focus, clear Dutch recovery guidance, reduced-motion support, and
touch targets suitable for mobile use. Validate this assumption with representative
employees before pilot use.
