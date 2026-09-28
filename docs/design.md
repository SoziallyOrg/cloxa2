# Cloxa design (direction C: calm and minimal)

The owner chose direction C on 2026-09-28, with Apple Health and Clock as the
references. The mockup is in `docs/design/direction-c.png`. Every screen follows these
rules. If a screen needs to break one, the rule is updated here first.

## Principles

1. **One thing per screen.** The screen's main fact (the timer, today's team) is the
   largest element. Everything else is visibly secondary.
2. **Calm.** White space does the work. There are no card shadows, gradients, decorative
   icons, emoji or illustrations. Separate things with space, and use hairline dividers
   only where space alone is not enough.
3. **Black is the action.** The primary button is solid ink with white text. There is
   one primary action per screen, and it sits at the bottom, in reach of the thumb.
4. **Colour means status, and nothing else.** Green = working. Amber = on break. Orange
   = needs attention. Red = error or destructive. Colour always comes with a word.
5. **Big where it matters.** The timer and key numbers use huge, light numerals. Body
   text is never smaller than 17px, and secondary text never smaller than 15px.
6. **Seniors first.** Targets are at least 48px, and the primary action at least 72px.
   There are no icon-only buttons and no gestures without a visible alternative.
   Contrast stays at AA or better everywhere (body text is AAA), and layouts still work
   at 200% zoom.

## Tokens (`packages/ui-tokens`)

| Token                                        | Light                                         | Dark                  | Use                                            |
| -------------------------------------------- | --------------------------------------------- | --------------------- | ---------------------------------------------- |
| `ink`                                        | `#0a0a0a`                                     | `#f5f5f5`             | text, primary button                           |
| `ink-2`                                      | `#5c5c5c`                                     | `#a3a3a3`             | secondary text (≥4.5:1)                        |
| `ink-3`                                      | `#8a8a8a`                                     | `#737373`             | tertiary text, only for 18px+ or non-essential |
| `paper`                                      | `#ffffff`                                     | `#000000`             | page                                           |
| `fill`                                       | `#f5f5f7`                                     | `#1c1c1e`             | grouped backgrounds, tracks, inputs            |
| `line`                                       | `#e8e8ea`                                     | `#2c2c2e`             | hairline dividers                              |
| `working` / `break` / `attention` / `danger` | `#15803d` / `#b45309` / `#c2410c` / `#b91c1c` | lighter tints in dark | status                                         |

- **Font:** the system UI stack
  (`-apple-system, "SF Pro Text", "Segoe UI Variable Text", Roboto, system-ui, sans-serif`).
  Numbers always use `font-variant-numeric: tabular-nums`.
- **Type scale:**

  | Name     | Size | Weight | Use            |
  | -------- | ---- | ------ | -------------- |
  | display  | 88   | 300    | timer          |
  | title    | 32   | 600    | page title     |
  | headline | 22   | 600    | section title  |
  | body     | 17   | 400    | text           |
  | callout  | 15   | 400    | secondary text |
  | number   | 34   | 500    | KPI            |

- **Radius:** 14px for buttons and inputs, 16px for grouped lists. Pills are fully
  round.
- **Spacing:** a 4px base. Screen gutters are 24px on phones and 40px on desktop. Leave
  at least 32px between sections.

## Components

- **Button.**
  - `primary`: solid ink, 72px on phones where it's the main action, 52px elsewhere.
  - `secondary`: 1.5px `line` outline, ink text.
  - `plain`: ink text only, for tertiary actions.
  - `destructive`: red text, outline style, never solid red.
- **Grouped list** (like iOS Settings). Rows sit on `fill`, grouped in rounded blocks
  with hairlines between them. A row can hold a title, secondary text and a trailing
  value or chevron, and is at least 56px tall. This is the default pattern for lists,
  settings and history.
- **Status line.** A 12px dot with a soft halo, followed by a word in the status colour.
- **Timer.** Display size, tabular numbers, `H:MM`. It ticks every 30 seconds.
- **Progress track.** A 6px `fill` track with an ink bar showing worked time against the
  planned day. It sits under the timer and has labels at both ends.
- **Timeline** (manager). Rows are fixed to 06–22h. Worked time is an ink bar, a break
  is a `ink-3` bar, planned but not started is a dashed outline, and an open shift has a
  pulsing right edge. The hour axis sits above, with light labels.
- **Numbers row** (KPIs). Cells are separated by hairlines with no card boxes. Orange is
  used only for "Aandacht nodig".
- **Navigation.**
  - Phone: a bottom tab bar with 3–4 text labels, with the active tab in ink and the
    others in `ink-3`. No icons are needed. If icons are added, they are always paired
    with a label.
  - Desktop: a quiet left sidebar with text items, the active item on a `fill`
    background, and counts right-aligned in `ink-3`.
- **Sheets and confirmations.** Destructive or important actions open a bottom sheet on
  phones and a centred dialog on desktop, with plain-language consequences and two
  buttons. Never use a native `confirm()`.
- **Feedback.** After clocking, a full-screen confirmation shows for 2 seconds: a large
  check mark, "Gestart om 08:02" and a vibration. It then returns to the clock. Errors
  appear inline, next to what caused them.

## Screens

- **Employee, Klok.**
  - Top: the logotype on the left, the first name and initial on the right (tapping the
    name opens the account sheet).
  - Then the status line, the timer, "Gestart om 08:02 · geen pauze", and the progress
    track against today's schedule.
  - The bottom holds the actions: the primary action plus Pauze.
  - When the employee isn't working, the timer shows today's planned start ("Gepland
    08:00–16:30") or nothing at all.
- **Employee, Uren.**
  - A week header with the net total, then days as a grouped list. Each row shows the
    date, start–end and net, plus "aangepast" and "offline" as small text tags.
  - Tapping a day opens its detail and "Klopt er iets niet?".
- **Employee, Vragen.** A grouped list of requests with their status, and a primary
  "Nieuwe vraag" button. The wizard shows one question per screen, with big choice rows
  and a progress indicator of 3 dots.
- **Manager, Vandaag.**
  - A title and a date, the numbers row, then the timeline for the team.
  - "Aandacht nodig" appears as inline row notes plus an orange count, never as a banner
    wall.
  - A site filter sits top right when there is more than one site.
- **Manager, other lists** (Aanvragen, Team, employee detail, settings) use grouped
  lists with one primary action per page.
- **Kiosk.**
  - Black and white, landscape first.
  - The names grid uses 120px tiles: initials in a circle on `fill`, with the name
    below.
  - The PIN pad has 88px keys and no borders, just digits on `fill` circles.
- **Login.** Centred and narrow. The logotype, one field, and one black button. The code
  step has one large OTP field. Nothing else.

## Copy

- B1 Dutch, using "je" and not "u".
- Short sentences. Verbs on buttons ("Start werk", "Stop werk", "Pauze", "Versturen").
- No jargon (no "sessie", "AAL", "factor"; say "beveiligingsapp").
- No blame ("Dat lukte niet. Probeer opnieuw.").
- Never claim legal compliance (see `CLAUDE.md`).

## Accessibility (non-negotiable)

- Real `<button>` and `<a>` elements.
- A visible focus ring (3px ink outline with a 2px offset).
- `aria-live` for status changes.
- Honour reduced motion.
- 320px minimum width.
- Test at 200% zoom and with the OS dark mode.
