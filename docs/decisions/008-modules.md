# 008: Modules (worker regimes and sectors)

**Status:** accepted · 2026-09-28

**Context.** Belgian employers mix regimes: students (650 h/year contingent), flexi-jobs
(start and end per day that must match the Dimona), interim workers (the user company is
responsible for their working time), horeca (voluntary overtime 450/360, GKS context),
construction (CIAO check-in/out from 1 Apr 2027) and telework. Sources are in
`docs/legal-notes.md` §1.4–1.10. The core must stay simple for an org that uses none of
them.

**Decision**

- A **module** is a TypeScript package `packages/modules/<name>` plus an optional
  migration. The core knows only a registry. Per org,
  `org_modules(module, enabled, config jsonb)` is set by the owner or an admin (fresh
  MFA, audited).
- **Module contract** (`@cloxa/modules`, pure TS, no I/O):
  - `id`, a label and a description (nl-BE i18n keys)
  - `statutes`: which `employees.statute` values it applies to
  - `employeeFields`: a zod schema for extra per-employee data, stored in
    `employee_module_data(employee_id, module, data jsonb)` under RLS
  - `counters(shifts, schedule, period)`: **factual, indicative** tallies, never
    verdicts
  - `hints(state)`: calm, non-blocking notes for the employee and manager views, e.g.
    "Nog 42 u van je studentencontingent (indicatief)". Wording must never claim legal
    outcomes (see `CLAUDE.md`).
  - `exportColumns`: extra CSV/JSON columns for the signed export
- **Modules never block clocking** and never change facts. They read the same effective
  events through `@cloxa/domain` and add information only.
- **First modules**, in order:
  - `student`: annual hours used against 650, with a planned-vs-actual view per quarter.
  - `flexi`: per-day start and end, plus a "differs from planned" note (the Dimona
    context).
  - `interim`: agency name and reference fields, plus an export filtered per agency.
  - `overuren`: a voluntary overtime tally against 360/240, or 450/360 for horeca, per
    calendar year, above the planned schedule.
  - `telework`: a location type per shift (site or home), selected at clock-in only if
    the org enables it. Nothing is tracked.
  - **Construction/CIAO is deferred** until the RSZ publishes a vendor channel. Until
    then, the product copy says plainly that Cloxa does not register with CIAO.
- **UI.**
  - Owners enable modules in Meer → Modules, which is a list with a switch and a short
    explanation per module.
  - Module data shows up in the employee detail page, counters and hints, and exports.
  - Nothing appears when no module is enabled.

**Consequences.** Every counter is labelled "indicatief" and is computed from facts. The
legal responsibility stays with the employer. Adding a sector is a package plus i18n,
with no changes to the core schema.
