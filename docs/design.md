# Cloxa design: identity D ("Signaal + ring")

Approved by the owner on 2026-10-02. The reference is `docs/design/identity-d.png`
(source: `docs/design/identity-d.html`). When this text and the picture disagree, the
picture wins. Earlier directions (paper/cobalt, direction C, the iOS-fidelity pass) are
retired: nothing may look like a stock iOS screen (no grouped inset Settings lists, no
translucent blurred bars, no SF-style large titles, no iOS switches or action sheets).

## Principles

1. **One obvious action per screen.** The main action is the lime button. There is one
   lime button per view at most.
2. **Status is a colour block, always with words.** Forest green = working, amber =
   pause, grey = not working, soft red = needs attention. Never colour alone.
3. **The logo is the timer.** The work timer is the logo's open "c" ring with the "now"
   dot in the gap. The same ring returns small in the clock bar and in detail panels.
4. **Calm, big, plain.** Seniors and non-technical staff: 18px base, targets ≥48px,
   primary clock action ≥72px, B1 Dutch.
5. **Desktop is its own layout**, not a wide phone (see Desktop).

## Tokens (`packages/ui-tokens`)

Light only for now (no dark mode: the forest surfaces are the "dark" of the brand).

| Token         | Value     | Use                                                      |
| ------------- | --------- | -------------------------------------------------------- |
| `forest`      | `#0E4A33` | brand, working status, primary buttons, active nav, bars |
| `forest-deep` | `#0A3626` | text on lime                                             |
| `lime`        | `#B5F04E` | THE main action and the "now" dot, only on forest        |
| `leaf`        | `#1FA855` | the "now" dot/accent on light surfaces (logo on light)   |
| `ink`         | `#10231B` | text                                                     |
| `ink-2`       | `#5F6B64` | secondary text (≥4.5:1 on paper and card)                |
| `paper`       | `#F5F6F1` | page background                                          |
| `card`        | `#FFFFFF` | cards, sidebar, panels                                   |
| `line`        | `#E2E5DC` | hairlines, outline buttons                               |
| `track`       | `#EDEFE7` | timeline track, toggle background `#E6E9DF`              |
| `on-forest-2` | `#B7D2C4` | secondary text on forest                                 |
| `break`       | `#F6C453` | pause block; text on it `#6B4A00`                        |
| `idle`        | `#DDE1D6` | "niet bezig" block; done bars `#AEB6AD`                  |
| `danger`      | `#D8432E` | destructive/attention button; attention bar              |
| `danger-tint` | `#FCE4DE` | attention block; text on it `#6F1E12`                    |

- **Type:** Bricolage Grotesque Variable, self-hosted (`@fontsource-variable`), weights
  400–800. Numbers and titles are bold (700–800) with tight tracking; body 500/400.
  Sizes: timer 50–92px, page title 34–40px, section 18px/700, body 17–18px, secondary
  14.5–16px, group label 13.5–14px/700 (uppercase only for tiny labels).
- **Radius:** buttons and nav items 12px; cards and rows 14–20px; the clock block and
  primary button 20px; hero bottom 32px. Never full pills, never square.
- **Elevation:** cards get `0 1px 2px rgb(16 35 27 / .06)`; floating bars none (they are
  solid forest). No blur, no translucency.

## Signature components

- **CRing** (logo timer): 270° open ring, gap on the right, round caps; track
  `white/16%` on forest (`track` on light); progress white on forest (`forest` on
  light); the dot sits in the gap (lime on forest, leaf on light) and pulses gently
  while the clock runs (respect `prefers-reduced-motion`). Progress = worked time vs
  planned shift length; with no plan, vs 8 hours; it never exceeds full.
- **Status hero** (employee Klok): a block with rounded bottom that takes the status
  colour: forest (working), amber (pause), card/idle (not started, finished). Holds
  logo, role switch, CRing with "Je werkt · 4u 12 · sinds 08:02", the primary button and
  the secondary button.
- **Role switch**: a two-segment toggle "Mijn klok | Beheer". Shown only when the user
  has both an employee record and a manager/admin/owner role. Phone: top right of every
  top-level screen. Desktop: top of the sidebar. Plain links (`/app`, `/manage`).
- **Clock bar**: whenever the user is clocked in (working or on pause) and is NOT on the
  Klok screen: a forest block with small CRing, "Jij werkt" + running time, and buttons
  Pauze / Stop werk (on pause: "Verder werken" / Stop werk; block turns amber). Phone:
  docked above the tab bar. Desktop: docked at the bottom of the sidebar. Stop werk asks
  for one confirmation.
- **Status group header**: a small coloured bar ("Aan het werk 4") above its rows.
- **Day timeline**: one row per person: name, a rounded track 06:00–18:00 (window widens
  for early/late/overnight work) with a forest bar, amber pause segments, grey for
  finished, dashed outline for planned, red for attention; hours worked and a short
  status on the right; a vertical "now" line with a forest pill "● 12:14".
- **Was / Wordt**: correction requests show two tiles, "Was" on white and "Wordt" on
  forest, then Goedkeuren (forest) and Weigeren (outline).
- **Buttons**: primary action lime on forest surfaces, forest on light surfaces;
  secondary = outline (`line`) on light, `white/14%` on forest; destructive = `danger`.
- **Tab bar** (phone): white, 4 items, the active one is a forest rounded tile with
  white text. Icon + word.
- **Toggle / tabs**: `#E6E9DF` container, 14px radius, the active segment a white tile.

## Layout

### Phone (<768px)

Top row = logo left, role switch right. Content on `paper` with white cards. Clock bar
(if any) above the tab bar. Manager lists are grouped under status group headers; each
person row shows a mini timeline bar.

### Desktop (≥1024px; 768–1023 = sidebar collapses to icons, side panel becomes a sheet)

Three columns:

1. **Sidebar** (244px, white): logo, role switch, navigation (active = forest tile),
   clock bar docked at the bottom.
2. **Main** (fluid, `paper`): title row with page actions on the right, then content
   built for width: stat blocks in a row, timeline, real tables with columns (Team,
   Uren, Exports, Activiteitenlog, Kiosks), forms in two columns at most 720px wide.
3. **Side panel** (330px, white): context for the selection. On Vandaag it has two tabs,
   "Medewerker" (selected person: clock block with CRing, today's events, indicative
   week totals, actions) and "Aanvragen n" (Was/Wordt cards, attention items). On table
   pages it shows the selected row's detail instead of navigating away. With nothing
   selected it shows a short hint, or the pending requests when there are any.

The employee area on desktop uses the same shell: sidebar (Klok, Uren, Vragen, Ik), main
with the status hero as a card next to today's/this week's facts, no stretched phone
column.

## "Fully built" checklist (every screen)

Loading skeleton, empty state with a next step, error state with retry, success
feedback, disabled and pending button states, focus-visible ring (2px forest, on forest
surfaces 2px lime), keyboard reachable, works at 320px width and at 200% zoom.

## Copy

nl-BE via `packages/i18n` only. Short and concrete ("Stop werk", "Pauze nemen", "Verder
werken"). Counters are labelled "indicatief". No compliance claims (see CLAUDE.md).

## Accessibility (non-negotiable)

Text contrast ≥4.5:1 (lime is only a background with `forest-deep` text, or a non-text
dot); status never by colour alone; real buttons/labels; targets ≥48px, primary clock
action ≥72px; reduced motion respected; no inline styles (CSP), so timeline positions
use CSS variables set through the existing nonce-safe approach or SVG attributes.
