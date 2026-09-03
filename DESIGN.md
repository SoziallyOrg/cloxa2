---
name: Cloxa
description: Daylight traveler-docket system for factual, reviewable work-time records.
colors:
  background: "#e7e3d8"
  paper: "#f8f6ee"
  paper-strong: "#eeeadf"
  ink: "#15212a"
  muted: "#4f5e65"
  rule: "#cbc5b6"
  rule-strong: "#9f998b"
  primary: "#0e4a67"
  primary-strong: "#08394f"
  primary-soft: "#d9e8ed"
  primary-foreground: "#fffdf6"
  primary-foreground-muted: "#d7e7eb"
  signal: "#e69523"
  signal-soft: "#fae7be"
  signal-ink: "#5d3500"
  danger: "#a13c34"
  focus: "#0e4a67"
typography:
  display:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "3rem"
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "-0.035em"
  display-sm:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "3.75rem"
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "-0.035em"
  display-lg:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "5.25rem"
    fontWeight: 600
    lineHeight: 0.96
    letterSpacing: "-0.035em"
  headline:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  brand:
    fontFamily: "Barlow Condensed, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: "1.75rem"
    letterSpacing: "-0.02em"
  body-large:
    fontFamily: "Aptos, Segoe UI, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 400
    lineHeight: "2rem"
    letterSpacing: "normal"
  body:
    fontFamily: "Aptos, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: "1.75rem"
    letterSpacing: "normal"
  control:
    fontFamily: "Aptos, Segoe UI, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: "1.5rem"
    letterSpacing: "normal"
  label:
    fontFamily: "Aptos, Segoe UI, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: "1.25rem"
    letterSpacing: "normal"
  status:
    fontFamily: "Aptos, Segoe UI, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: "1rem"
    letterSpacing: "normal"
rounded:
  lg: "0.5rem"
  xl: "0.75rem"
  "2xl": "1rem"
  full: "9999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "5": "1.25rem"
  "6": "1.5rem"
  "7": "1.75rem"
  "8": "2rem"
  "10": "2.5rem"
  "12": "3rem"
  "14": "3.5rem"
  "16": "4rem"
  "20": "5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 1.25rem"
    height: "2.75rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-strong}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 1.25rem"
    height: "2.75rem"
  button-primary-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.xl}"
    padding: "0 1.5rem"
    height: "3rem"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 1.25rem"
    height: "2.75rem"
  button-secondary-hover:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 1.25rem"
    height: "2.75rem"
  button-quiet:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 0.75rem"
    height: "2.75rem"
  button-quiet-hover:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.primary-strong}"
    typography: "{typography.label}"
    rounded: "{rounded.xl}"
    padding: "0 0.75rem"
    height: "2.75rem"
  site-navigation:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    padding: "0 1rem"
    height: "4rem"
  docket-surface:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.5rem"
  workflow-marker:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.primary}"
    typography: "{typography.status}"
    rounded: "{rounded.full}"
    size: "2rem"
  auth-shell:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.5rem"
  role-status:
    backgroundColor: "{colors.signal-soft}"
    textColor: "{colors.signal-ink}"
    typography: "{typography.status}"
    rounded: "{rounded.full}"
    padding: "0.25rem 0.75rem"
  time-clock-idle:
    backgroundColor: "{colors.paper-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.25rem"
  time-clock-working:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.2xl}"
    padding: "1.25rem"
  status-panel:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.2xl}"
    padding: "1.5rem"
---

# Design System: Cloxa

## Overview

**Creative North Star: "Quality-control traveler docket"**

Cloxa presents work-time records as a daylight quality-control document: sturdy paper
fields, deep docket ink, cobalt actions, amber inspection marks, and rules that make
ownership and sequence visible. Grounded mode and seed `4cf65f85` resolve into a
practical worksite artifact, not a polished payroll dashboard.

Material hierarchy carries more identity than ornament. Broad bordered dossiers hold
related work, a 32px ruled-paper texture signals traceable record space, and condensed
headings make decisive landmarks inside calm body copy. Curves soften touch targets
without turning every area into generic rounded-card chrome.

**Key Characteristics:**

- Daylight paper layers separated by precise one-pixel rules.
- Condensed docket headings paired with calm humanist interface text.
- Cobalt fields and actions with sparse amber inspection marks.
- Broad dossiers that collapse into a clear linear trace at 320px.
- Flat structural depth, with lift reserved for the primary action.

## Colors

Palette reads like a traveler document under daylight: warm-neutral paper, cool deep
ink, worksite cobalt, and a small amber notation system.

### Primary

- **Worksite Cobalt** (`primary`): filled actions, links, icons, workflow markers, and
  strong interactive emphasis.
- **Deep Cobalt** (`primary-strong`): primary hover and stronger quiet-action text.
- **Pale Cobalt Wash** (`primary-soft`): hover field behind quiet actions.
- **Docket White** (`primary-foreground`): readable text over saturated cobalt fields.
- **Mist Cobalt** (`primary-foreground-muted`): secondary copy inside cobalt auth
  panels.
- **Focus Cobalt** (`focus`): semantic focus treatment; intentionally aliases Worksite
  Cobalt.

### Secondary

- **Inspection Amber** (`signal`): brand-mark check, selection, and exceptional focus
  notation.
- **Carbon-Copy Amber** (`signal-soft`): restrained status-pill and selection fill.
- **Amber Ink** (`signal-ink`): readable text over Carbon-Copy Amber.

### Tertiary

- **Correction Red** (`danger`): field-validation copy, request errors, and contained
  failure strips.

### Neutral

- **Daylight Board** (`background`): page canvas behind dossiers.
- **Traveler Paper** (`paper`): primary content, navigation, buttons, and panels.
- **Pressed Paper** (`paper-strong`): alternating section field and secondary hover.
- **Deep Docket Ink** (`ink`): headings, main copy, outlines, and brand mark.
- **Steel Pencil** (`muted`): explanatory and supporting text.
- **Hairline Rule** (`rule`): quiet dividers and ruled-paper lines.
- **Inspector Rule** (`rule-strong`): dossier outlines, workflow connectors, and
  stronger separators.

**The Cobalt Carries Action Rule.** Filled cobalt marks the primary route; quiet cobalt
handles low-emphasis navigation and inline actions.

**The Amber Means Status Rule.** Amber records status or inspection, never the main call
to action.

**The Paper Is Structure Rule.** Separate responsibilities with paper tiers and
one-pixel rules before adding elevation.

## Typography

**Display Font:** Barlow Condensed (sans-serif fallback)

**Body Font:** Aptos (Segoe UI, sans-serif fallback)

**Character:** Barlow Condensed supplies the compact authority of an inspection docket.
Aptos or Segoe UI keeps Dutch descriptions, controls, and status copy calm and readable.

### Hierarchy

- **Display** (`display`, `display-sm`, `display-lg`): responsive home-page claim,
  rising from compact mobile scale to the broad desktop dossier.
- **Headline** (`headline`): section and status-state headings.
- **Title** (`title`): workflow, role, and compact shell landmarks.
- **Brand** (`brand`): Cloxa wordmark beside the docket mark.
- **Body Large** (`body-large`): first-order descriptions and role-shell guidance.
- **Body** (`body`): ordinary explanatory copy with generous leading.
- **Control** (`control`): large button text.
- **Label** (`label`): default buttons, workflow labels, navigation, and scoped list
  items.
- **Status** (`status`): small pills and workflow marker numerals.

**The Docket Voice Rule.** Barlow Condensed carries landmarks only; body copy and
controls stay in the humanist body family.

**The Readable Copy Rule.** Tight tracking belongs to condensed headings, never
explanatory paragraphs or controls.

## Layout

Primary shells share a centered 72rem maximum width. Gutters begin at 1rem, increase to
1.5rem at the 640px breakpoint, and reach 2rem at 1024px. Content padding progresses
from 1.5rem on small screens to 2.5rem or 3.5rem where space permits; spacing follows
the implemented Tailwind numeric scale recorded in frontmatter.

Home dossier becomes a `0.92fr / 1.08fr` two-column split at 1024px. Auth shell uses a
narrower `0.72fr` cobalt field beside a `1.28fr` content field. Below 1024px both become
vertical documents. Workflow sequence is a vertical trace on small screens and a
four-column horizontal trace on large screens. Page supports a 320px minimum viewport
without horizontal composition loss.

Role headings wrap naturally, with status below the title before 640px and beside it at
wider widths. Correction comparisons stack original then proposal below 1024px; decision
controls stack below 640px. Names, employee codes, reasons, and notes wrap within
available width. Protected dialogs retain 1rem viewport gutters and scroll within 90dvh
so long decisions remain reachable on compact screens.

**The One Dossier Rule.** Lead each shell with one broad bordered document; use internal
rules and fields instead of a scatter of equal cards.

**The Mobile Trace Rule.** Sequence reads top to bottom before it reads left to right;
never preserve the desktop workflow row at the cost of 320px legibility.

## Elevation & Depth

System is flat and structurally layered. Canvas, paper, and pressed-paper tones create
planes; one-pixel borders, ruled texture, and clipped fields explain containment.
Surfaces carry no shadow. Primary action alone receives a restrained low lift.

### Shadow Vocabulary

- **Primary Action Lift** (`0 8px 20px -14px var(--color-ink)`): subtle depth under the
  filled primary button only.

**The Flat-by-Default Rule.** Use tone, rule, and material texture for depth; do not
float dossiers or status panels.

## Shapes

Shapes follow a small, legible hierarchy: 0.5rem corners for compact focusable links,
0.75rem corners for controls, 1rem corners for broad dossiers and panels, and full
circles only for step markers and status pills. Outer surfaces clip their contents so
cobalt fields and ruled paper share one continuous silhouette. Borders are one pixel;
the brand mark uses its own 7px internal corner inside a 30px square.

**The Few Radii Rule.** Match radius to scale and function; do not introduce
intermediate corner values or make ordinary controls pill-shaped.

## Components

### Buttons

Buttons feel compact, sturdy, and worksite-ready.

- **Shape:** 0.75rem corners, 2.75rem default height, 3rem large height, and at least a
  44px touch target.
- **Primary:** cobalt field, docket-white text, one-pixel cobalt border, and Primary
  Action Lift; default horizontal padding is 1.25rem and large padding is 1.5rem.
- **Secondary:** Traveler Paper with Deep Docket Ink and an Inspector Rule border; hover
  moves to Pressed Paper and an ink border.
- **Quiet:** transparent field with cobalt text and 0.75rem horizontal padding; hover
  adds Pale Cobalt Wash and Deep Cobalt text.
- **Hover / Focus / Active:** 200ms ease-out state transition, 3px cobalt focus ring,
  and a motion-safe 1px downward active nudge.
- **Disabled:** pointer interaction removed and opacity reduced to 55%.

### Ruled Docket Surface

Reusable record field uses Traveler Paper, a one-pixel Inspector Rule outline, 1rem
corners, and horizontal rules every 32px. Rule ink is mixed to 52% against transparency.
The surface appears in home workflow, authentication, and role shells.

### Workflow Trace

Each 2rem marker is a paper-filled cobalt circle with a four-pixel paper halo. Inspector
Rule connectors run vertically on small screens and horizontally at 1024px. Connector
arrival animates for 620ms with `cubic-bezier(0.16, 1, 0.3, 1)` only when reduced motion
is not requested.

### Navigation

Sticky 4rem header uses a 95% Traveler Paper field and Hairline Rule bottom border.
Brand mark and condensed wordmark anchor left; one quiet login action anchors right.
Keyboard skip link starts off-canvas, then enters on focus as an ink field with paper
text and an amber focus ring.

### Auth Shell

Authentication shell is one clipped ruled dossier. Mobile stacks a cobalt identity field
above paper content; large layout places the field at 0.72fr beside 1.28fr content.
Cobalt field uses Docket White for icon and primary content, with Mist Cobalt for
descriptor copy.

### Role Shell

Role shell uses a ruled content dossier beneath a simple ruled title row. Status appears
as a full-radius Carbon-Copy Amber pill with Amber Ink, Inspector Rule border, and
compact status typography. Title wraps instead of truncating; mobile status sits below
the heading. At 640px, title and status share a row.

### Employee Time Clock

Time clock pairs one stateful action field with today's factual ledger. It stays a
single-column document through compact and tablet widths, then becomes a
`minmax(0, 0.85fr) minmax(0, 1.15fr)` split at 1024px. Both columns keep `min-width: 0`;
at 320px, time ranges and supporting copy wrap while the action remains full-width.

- **Idle:** Pressed Paper field, Inspector Rule outline, muted clock marker, and filled
  cobalt start action.
- **Working:** cobalt field, Docket White heading, Mist Cobalt timestamp, and paper stop
  action. Color inversion makes active recording unmistakable without adding elevation.
- **Primary action:** full-width, 4rem minimum height, 1.125rem control type, and
  existing button focus, disabled, and pending behavior.
- **Today's ledger:** unboxed list under a ruled heading; entries use Hairline Rule
  separators, factual time ranges, and cobalt only for the open registration.
- **Feedback:** success stays within current field; errors receive a contained paper
  strip with Correction Red text and an alert role.

### Inputs / Fields

Use shared paper-field treatment for claim timestamps, occurrence selectors, and
reasons.

- **Style:** Traveler Paper, Deep Docket Ink, one-pixel Inspector Rule border, 0.75rem
  corners, 1rem body type, 0.75rem horizontal padding, and 0.5rem vertical padding.
  Controls fill available width with a 2.75rem minimum height; reason fields allow
  vertical resizing from a 7rem minimum height.
- **Labels / Help:** place semibold labels above controls and muted help beneath them.
  Associate labels and help with their control IDs.
- **Focus / Pending:** use cobalt border and 3px Focus Cobalt ring at 30% opacity.
  Disable controls during submission, reduce opacity to 55%, and mark form busy.
- **Errors:** place Correction Red messages beside affected fields, set `aria-invalid`,
  and connect error text with `aria-describedby`. Form failures use paper strips with
  red border and alert semantics; success uses Pale Cobalt Wash with status semantics.

### Employee Correction Claims

Keep requests within existing ruled role dossier. Employees move from recent closed
registrations to an inline claim form, then their own request history. Separate these
sections with rules and condensed headings; keep original facts and proposed changes
distinct in labels and help copy.

- **Form layout:** stack timestamp and occurrence controls through tablet widths; pair
  them at 1024px. Keep grid children shrinkable and actions full-width at 320px.
- **Wall-time entry:** use text fields for `dd/mm/yyyy HH:mm` in Europe/Brussels, with
  optional seconds and up to six fractional digits. Preserve source timestamp precision
  in prefilled values. Repeated autumn hours require explicit earlier/later occurrence
  selectors for each endpoint.
- **Keyboard flow:** move focus to form heading on open or target change. Return focus
  to initiating control on close; keep opening controls' expanded state available to
  assistive technology.
- **Claim history:** use unboxed ruled rows with proposed time range, wrapping reason
  text, and existing amber status pill. Offer secondary withdrawal action on pending
  requests. Resolved requests expose outcome, decision time, and manager note when
  present. Preserve line breaks in reasons and notes; keep long text inside mobile
  width.

### Original / Proposal Comparison

Review rows remain unboxed inside the ruled dossier. Native disclosure summaries keep
employee identity, code, request type, and amber status visible before expansion.

- **Fact / claim:** pair flat Pressed Paper for original facts with Pale Cobalt Wash for
  proposed values. Use explicit headings as well as material contrast. Missing facts
  receive a plain explanation in the original field.
- **Exact times:** show each endpoint on its own line with tabular numerals. Preserve
  source fractional seconds through microsecond precision and show Europe/Brussels
  offset beside local time; repeated autumn hours remain distinguishable.
- **Record context:** place employee reason, submission time, decision time, and manager
  note beneath the comparison. Preserve line breaks and wrap long names, codes, reasons,
  and notes. Keep completed rows readable without decision controls.
- **Disclosure / actions:** native summary supports keyboard expansion and cobalt focus.
  Pending rows offer filled cobalt approval and paper rejection controls; both open a
  protected decision dialog.

### Protected Decision Dialog

Native modal dialog carries Traveler Paper, Inspector Rule outline, 1rem corners, and an
ink backdrop at 40% opacity. It uses existing paper fields and button states without
adding a new elevation style.

- **Decision context:** condensed heading and plain consequence copy precede employee
  identity and exact proposed interval. Rejection requires an explanation; approval
  permits an optional note. Labels explain that employees can read the note.
- **Field / validation:** note field follows shared input styling, with 7rem minimum
  height and 500-character limit. Field errors connect to the textarea and expose
  invalid state. Failed submissions retain dialog content and focus alert feedback.
- **Protected submission:** mark form busy, announce saving, and disable fields and
  actions while pending. Dismissal and duplicate submission are blocked during saving.
  Escape or cancellation returns focus to initiating control when idle; success closes
  the dialog and focuses visible result feedback.
- **Compact layout:** maximum width is 36rem; viewport gutters remain 1rem. Dialog
  scrolls within 90dvh. Controls stack on mobile, and confirmation copy can wrap.

### Status State

Loading, error, not-found, and unauthorized states share a centered paper panel with
1rem corners, Inspector Rule border, cobalt icon, condensed headline, muted recovery
copy, and optional button actions. Live icon rotation respects reduced-motion settings.

**The States Must Read Rule.** Every interaction keeps a visible hover, keyboard focus,
active, disabled, or live-state treatment appropriate to its behavior.

## Do's and Don'ts

### Do:

- **Do** lead shells with one broad dossier and divide responsibility with rules or
  material fields.
- **Do** reserve cobalt for actions, focus, icons, and workflow trace markers.
- **Do** reserve amber for inspection marks, selections, and status communication.
- **Do** use condensed type for landmarks and humanist type for explanations and
  controls.
- **Do** preserve a linear, readable workflow at the 320px minimum viewport.

### Don't:

- **Don't** add shadows to ordinary dossiers, role panels, or status states.
- **Don't** use amber as a primary action color.
- **Don't** turn every content group into an independent rounded card or pill.
- **Don't** add decorative gradients; the ruled 32px paper texture is the implemented
  gradient language.
