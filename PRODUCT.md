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
- One Dutch-speaking manager who will eventually review corrections and hand approved
  records to a payroll-preparation role.
- First customer profile: one organization, one worksite, 5–20 workers.

## Product Purpose

Cloxa will reduce time spent collecting, correcting, approving, and handing off factual
work-time records while preserving a visible history of changes. Current pilot scope
supports invitation authentication and secure employee clock-in/out before correction,
approval, and export workflows are added.

## Positioning

Cloxa centers a reviewable correction chain for one small Flemish team. It does not
calculate wages, overtime, premiums, statutory rest, declarations, or sector-specific
rules, and it must not be presented as payroll or compliance software.

## Operating Context

Employees primarily use a mobile browser at or around work. A manager reviews records in
a browser and will eventually export approved factual data as CSV or JSON. Research
pilots, if authorized later, run beside the customer’s existing official process.

## Capabilities and Constraints

- Implemented workflow: invitation, login, secure employee clock-in/out, and today's own
  factual registrations.
- Planned workflow continues with correction request, manager approval, approved export,
  and visible change history.
- Public signup and automatic billing remain disabled.
- No breaks, manual entries, corrections, approvals, exports, scheduling, billing,
  realtime, native app, ORM, Redux, Redis, queues, storage, analytics, microservices, or
  offline service worker.
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
