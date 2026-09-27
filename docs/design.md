# Cloxa design system

For Belgian SME staff: seniors, shared tablets, cheap Android phones. Calm and obvious,
not childish. A good bank app crossed with a Dutch public-service site: clear hierarchy,
plain language, one obvious action per screen.

## Principles

- Flat. No gradients, glassmorphism, drop shadows or decorative icons.
- Big and clear: 18px body text, ≥48px touch targets, 72px primary action.
- One primary action per screen; secondary actions stay visibly secondary.
- Colour never carries meaning alone — every status has a text label too.
- System fonts only (CSP allows no external font loading).
- Works from 320px wide and at 200% browser zoom, no horizontal scroll.

## Tokens (`packages/ui-tokens`)

- Colours: `ink`/`paper` (AA/AAA text), `primary` (#0e4a67 cobalt), `surface`, `border`,
  plus paired status colours (`working`=green, `break`=amber, `off`=neutral grey,
  `error`=red), each with a `-bg` tint for badges.
- Dark mode follows `prefers-color-scheme`, no manual toggle.
- Type scale: 18px base up to 40px (`text-status`) for the clock sentence; 32px
  monospaced for the OTP input.
- Spacing: `touch-target` (48px), `primary-action` (72px), `bottom-nav` (64px),
  `kiosk-tile` (96px), `pin-key` (80px).
- Radius: `sm`/`md`/`lg`. Focus ring: `.focus-ring` utility class, ≥3px outline, never
  colour-only, always visible on `:focus-visible`.

## Components

- `apps/web/src/components/ui`: primitives (`Button`, `Card`, `Stack`, `Heading`,
  `Field`, `TextInput`, `OtpInput`, `StatusBadge`, `Alert`, `EmptyState`, `BottomNav`,
  inline icons).
- `apps/web/src/components/clock`: `ClockStatus`, `ClockActions`, `ShiftList`,
  `OfflineBanner`. Pure formatting lives in `format.ts` / `shift-row.ts` so it's
  unit-testable without a DOM.
- `apps/web/src/components/employee|kiosk|manage`: `EmployeeHome`, `KioskHome`,
  `TodayBoard` — full-screen layouts built from the above.
- Server Components by default; `"use client"` only where state or effects are needed
  (`Alert`, `ClockActions`, `KioskHome`, the preview page).

## Component rules

- `Button`: variants `primary`/`secondary`/`danger`/`quiet`, sizes `md` (48px) / `xl`
  (72px, full width). `danger` is an outline, not a solid fill — serious, not alarming.
  Disabled buttons stay full-contrast, never faded to grey-on-grey.
- `Field`: label always visible above the input, never placeholder-only. Hint and error
  text are linked via `aria-describedby`.
- `OtpInput`: one input (`inputMode="numeric"`, `autocomplete="one-time-code"`), never
  six separate boxes — those break paste and screen readers.
- `StatusBadge`/`Alert`: colour dot or border plus a translated label; `Alert` uses
  `role="alert"`/`"status"` and moves focus to itself on appear.

## Copy tone

- nl-BE, B1 level, "je"-form, plain words, short sentences.
- No blame ("Vergeten uit te klokken", not "Je hebt een fout gemaakt").
- No legal/compliance claims (see `CLAUDE.md`); factual language only.
- Every string lives in `packages/i18n`'s catalog — no literals in JSX
  (`react/jsx-no-literals` enforces this in `apps/web`).

## Accessibility

- WCAG AA everywhere, AAA (≥7:1) for body text against `paper`.
- Real `<button>`/`<label>` elements, never `<div onClick>`.
- Visible focus ring ≥3px on every interactive element.
- Status is never colour-only; text label is mandatory.
- Bottom navigation: at most 3 items, `aria-current="page"` on the active one, 64px tall
  so it's reachable with a thumb.
