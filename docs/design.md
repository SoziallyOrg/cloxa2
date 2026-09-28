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
  - `secondary`: 1.5px `line` outline on `surface`, ink text. Never on `paper`: in dark
    mode that is black, which reads as a black button on a sheet.
  - `plain`: ink text only, for tertiary actions.
  - `destructive`: red text, outline style, never solid red.
  - Inside a sheet, the sheet's main action is `primary` too, so it looks the same as on
    the page in both themes.
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
  - Phone: a bottom tab bar with 3–4 tabs, each an icon plus a label, the active tab in
    ink. A count badge (pending questions on Vragen) is visual only.
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

## iOS vibe, not an iOS copy (owner feedback, 2026-09-28)

The owner wants the **feel** of a premium iOS app (think Apple Health, Clock, Things,
Linear), **not** a 1:1 copy of the stock Settings app. The approved reference is batch 1
as shown in `docs/design/batch1-approved.png`: white pages, soft grey row groups, a big
thin timer, and black primary buttons. Make it **more sophisticated, modern and
minimal**, with effortless UX.

**Keep from iOS (the vibe):**

- **Motion.**
  - Push and pop page slides (View Transitions), sheets that spring up with a grabber
    and drag-to-dismiss, and pull-to-refresh.
  - Pressed states: rows get a subtle grey highlight, buttons scale to 0.98 and dim
    slightly.
  - Haptics on clock actions.
  - Everything respects reduced motion.
- **Navigation.** A large title that collapses into an inline title on a translucent
  blurred bar with a hairline when scrolled, and a back chevron with the previous title.
- **Tab bar.** Translucent blur, **thin monochrome line icons (1.5px stroke) plus small
  labels**, and the active tab in ink. No colour.
- **Sheets, action sheets and alerts** for choices and confirmations, styled in our
  monochrome look (white and ink, with red only for destructive actions).
- **Typeface.** SF on Apple devices, and self-hosted Inter elsewhere, with tight
  tracking on titles.

**Do NOT copy (the owner said no):**

- No coloured icon tiles in rows. If a row needs an icon, use a thin monochrome line
  icon in `ink-2`, and only where it helps scanning (for example settings). Data rows
  get no icons.
- No `#f2f2f7` Settings-grey page backgrounds. Pages are white (dark: black). Row groups
  sit on the soft `fill` (`#f5f5f7` / dark `#1c1c1e`) with a 16px radius, as in batch 1.
- No green iOS switches. The switch is monochrome: ink when on, `fill` when off.
- No uppercase section headers. Use small sentence-case labels in `ink-2` (13–15px), as
  in batch 1.

**Refinement targets ("sophisticated, modern, minimal"):**

- **One rhythm.** A 24px gutter on phones and 32px between sections. Rows are 56px
  (single line) or 64px (two lines). Buttons are 56px (primary 64px on Klok).
- **Typography.**
  - Titles are 30–34px, weight 600, with letter-spacing -0.02em.
  - The timer is 96px, weight 200–300, with tabular figures.
  - Secondary text uses `ink-2`. Never more than 3 text sizes on one screen.
- **Soft geometry.** Radius 16 on groups, 14 on buttons and inputs, and full rounding on
  pills. No borders on cards. Hairlines only as separators inside groups.
- **Quiet chrome.** The logo in the header is small. The user's name is a subtle button
  that opens the account sheet.
- **Inputs.** Time and date fields are large, calm and filled (`fill` background, no
  heavy black focus border: use a 2px ink ring _outside_ on focus-visible only). They
  show values like "08:00" in large tabular text, with the native picker behind them.
- **Status.** A small dot plus a word. Colours are muted, not saturated: green
  `#207936`, amber `#b45309`, red `#b91c1c`, and orange for attention `#c2410c`.
- **Empty and error states.** A thin line icon (not in a coloured circle), one sentence,
  and one action.
- **Less on screen.** When in doubt, hide it behind a tap (a sheet), and keep one clear
  primary action per screen.
- **Desktop.** A quiet sidebar with thin line icons plus labels, the content in a
  readable column, and sheets as centred cards.

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
