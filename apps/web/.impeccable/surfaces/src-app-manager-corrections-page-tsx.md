---
version: 1
slug: "src-app-manager-corrections-page-tsx"
primary_target: "src/app/manager/corrections/page.tsx"
related_targets:
  - "src/components/manager-correction-panel.tsx"
  - "src/components/correction-request-panel.tsx"
  - "src/components/role-shell.tsx"
  - "src/app/employee/corrections/page.tsx"
---

# Manager correction review surface

## Scope and mode

Operate surface for manager review of employee correction claims within one
organization. All pending requests precede latest 50 terminal requests: approved,
rejected, or withdrawn. This brief records implemented Phase 5 behavior; public
foundation brief remains scoped to its earlier foundation surface.

## Audience and action

Manager inspects employee claim against original time facts, then approves exact
proposal or rejects it with explanation. Approval applies proposed interval; rejection
preserves time registration. Employees see outcome, decision time, and manager note in
own history.

## Content proof

Native disclosure summary exposes employee name, employee code, request type, and
status. Expanded row pairs original registration with proposed interval; missed-entry
claims explain absence of original registration. Each endpoint preserves source
fractional seconds through microsecond precision and shows Europe/Brussels offset.
Reason, submission time, decision time, and manager note remain readable record context.

Pending count and separate history heading establish queue order. Empty queue, empty
history, load failure with reload action, field errors, failed decision, saving, and
successful decision have explicit text states.

## Visual direction

Preserve quality-control traveler docket, grounded mode, and seed `4cf65f85`: daylight
paper, deep ink, cobalt actions, amber status, Barlow Condensed landmarks, and ruled
dossier. Original facts sit on Pressed Paper; proposals sit on Pale Cobalt Wash. Flat
comparison fields use headings and material contrast. Existing token values remain
unchanged.

First viewport introduces manager review within existing role shell and leads into
pending requests. Native details disclose full evidence without turning each request
into a card. Original and proposal stack below 1024px; action pairs stack below 640px.
Role heading wraps and status moves beneath it on mobile. Names, codes, reasons, and
notes wrap at 320px.

## Decision interaction

Approve and reject open native modal dialog with consequence copy, employee identity,
and exact proposed interval. Approval note is optional; rejection explanation is
required. Notes are limited to 500 characters and labeled as visible to employee.

Dialog retains 1rem viewport gutters, 36rem maximum width, paper field, and ink
backdrop. Content scrolls within 90dvh. Pending submission disables fields and actions,
announces saving, and blocks dismissal and duplicate submission. Idle cancellation
restores initiating control focus. Failure retains dialog and focuses feedback; success
closes dialog and focuses result. Native disclosure and modal behavior provide keyboard
interaction; cobalt rings show focus.

## Constraints

Dutch (`nl-BE`) copy remains centralized. Access stays limited to same-organization
managers. No exports, arbitrary fact editing, or visual redesign in this surface.
Decisions apply exact submitted proposals; original and proposed values remain distinct
in presentation.

## Evidence and limits

Documentation derives from manager page and panel, employee correction history, shared
role shell, timestamp formatter, and existing design tokens. Finish-review handoff
reports four desktop/mobile and decision-dialog screenshots reviewed in
`.impeccable/review/`. Long employee-code wrapping was fixed and confirmed with a
32-character code in a fresh 320px production capture and passing manager journey. Final
verification belongs to implementation handoff; this brief makes no production-readiness
claim.
