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

| Token                                        | Light                                         | Dark                                          | Use                                     |
| -------------------------------------------- | --------------------------------------------- | --------------------------------------------- | --------------------------------------- |
| `ink`                                        | `#0a0a0a`                                     | `#f5f5f5`                                     | label, primary button                   |
| `ink-2`                                      | `#6c6c70`                                     | `#98989f`                                     | secondary label (≥4.5:1 everywhere)     |
| `ink-3`                                      | `#8a8a8e`                                     | `#7c7c80`                                     | tertiary, only 18px+ or non-essential   |
| `paper` / `fill` / `line`                    | `#ffffff` / `#f5f5f7` / `#e8e8ea`             | `#000000` / `#1c1c1e` / `#2c2c2e`             | plain page, tracks and inputs, outlines |
| `grouped` / `surface`                        | `#f2f2f7` / `#ffffff`                         | `#000000` / `#1c1c1e` (sheets: one step up)   | inset grouped page / rows               |
| `separator` / `pressed`                      | `#c6c6c8` / `#d1d1d6`                         | `#38383a` / `#3a3a3c`                         | hairlines (0.5px) / pressed row         |
| `working` / `break` / `attention` / `danger` | `#207936` / `#b25000` / `#c93400` / `#d70015` | `#30d158` / `#ffd60a` / `#ff9f0a` / `#ff6961` | status, plus `*-tint` for halos         |
| `material-bar` / `-sidebar` / `-sheet`       | translucent white                             | translucent black                             | bars, sidebar, alerts (with 20px blur)  |

`packages/ui-tokens/src/tokens.test.ts` computes every text/background ratio. The iOS
green `#248a3d` is 4.40:1 on white, so text uses `#207936`.

- **Font:**
  `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable", system-ui, sans-serif`:
  San Francisco on Apple devices, self-hosted Inter elsewhere. Numbers always use
  `font-variant-numeric: tabular-nums`.
- **Type scale:** the iOS text styles (`text-large-title`, `title-1/2/3`, `headline`,
  `body`, `callout`, `subhead`, `footnote`, `caption`, `caption-2`), plus `display`
  (88/300, timer) and `number` (34/500, KPI). `title` (32/600) remains only for screens
  not yet on `NavBar`.

- **Radius:** 14px for buttons, inputs and alerts, 10px for inset grouped lists, 7px for
  icon tiles. Pills are fully round.
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

## iOS fidelity (owner requirement, 2026-09-28)

The owner wants Cloxa to **look and behave like a native iOS app**, and every screen to
be complete. The web app follows Apple's Human Interface Guidelines patterns, rebuilt
with our own code (no Apple assets):

- **Typeface.** Use `-apple-system` / SF Pro on Apple devices. Everywhere else,
  self-hosted **Inter** (variable, OFL) is the stand-in, since it looks close to SF. Use
  the iOS text styles: Large Title 34/700, Title 1 28, Title 2 22, Headline 17/600, Body
  17, Callout 16, Subhead 15, Footnote 13, Caption 12. The timer keeps display 88/300.
- **Navigation bar.**
  - Every page has a **large title**. On scroll it collapses into a centred inline title
    on a translucent bar (`backdrop-filter: blur`, with a hairline under it once
    scrolled).
  - Pushed pages get a back button: a chevron plus the previous page's title.
  - Trailing actions are text buttons ("Klaar", "Bewerk") or icon buttons (44px
    targets).
- **Tab bar** (phone). It is translucent and blurred, with a hairline on top and
  respects the safe-area inset. Each tab has an **icon plus a label** (10–11px medium).
  Icons are outline when inactive and filled when active. Use an open SF-like icon set
  (Lucide), same stroke width everywhere. There are 3–5 tabs.
- **Inset grouped lists.**
  - The page background is `#f2f2f7` (dark `#000`), groups are white (dark `#1c1c1e`)
    with a 10px radius, and there is a 16px inset.
  - Rows are 44px minimum (52px for two-line rows). Separators are inset from the
    leading edge.
  - A row can have a leading icon (on a coloured 29px rounded square, like Settings), a
    title, a subtitle, a trailing value in secondary colour, and a chevron.
  - Section headers are uppercase footnote text in secondary colour, and footers are
    footnote text.
- **Controls.**
  - **Segmented control**: a pill track with a white sliding thumb.
  - **Switch**: a real iOS-style toggle in green, for booleans in settings.
  - Native `<input type=time/date>`, which are wheels on iOS.
  - **Action sheet** for choices and destructive confirmations. A centred **alert** (two
    buttons, where the destructive one is red) for irreversible steps.
  - **Sheets**: a grabber, rounded top corners, and a detent feel (medium or large).
    Drag down to dismiss, plus a "Sluiten"/"Klaar" button.
- **Motion.**
  - Push navigation slides from the right, and back slides out (View Transitions API
    where supported).
  - Sheets spring up. Buttons dim on press (`active` opacity 0.6), with no hover-only
    affordances.
  - Pull-to-refresh on Klok, Uren, Vragen and Vandaag.
  - Everything respects `prefers-reduced-motion`.
- **Haptics.** Use `navigator.vibrate` where available: a light tap on clock actions, a
  double tap on errors.
- **Colour.** The primary buttons stay ink (direction C). Status colours follow the iOS
  system palette, tuned so text reaches AA: green `#248a3d`, orange `#c93400`, red
  `#d70015`, plus tints for dots and backgrounds.
- **Desktop.** This works like **iPadOS or macOS**:
  - a translucent sidebar (source list with icons and labels), and the content in a
    readable column (max ~720px for lists; full width for the timeline)
  - sheets become centred modal cards
  - large titles stay large
- **PWA.** `display: standalone`, a status bar style, and `theme-color` for light and
  dark. The apple-touch-icon and splash colours come from the logo, so "Add to Home
  Screen" feels like an app.

### "Fully built" checklist (every screen must have all of these)

1. **Loading:** a skeleton that matches the final layout (`loading.tsx`). No spinners on
   full pages.
2. **Empty:** a friendly empty state (an icon in a circle, one sentence and one action).
3. **Error:** inline for form fields; for page-level errors, a calm error view with
   "Opnieuw proberen".
4. **Offline:** a banner, and actions behave as the ADRs say.
5. **Success:** confirmation feedback (the full-screen check for clocking, a toast-like
   inline confirmation for others).
6. **Pending:** buttons show a pending state, and double submits are impossible.
7. **Long content:** long names are truncated with an ellipsis. Lists of 100+ items stay
   usable (search or segmenting).
8. **Accessibility:** focus order, labels, `aria-live` for status, and it works at 200%
   text.
9. **Both themes and both form factors** are checked in `pnpm screens`.

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
