/**
 * Design tokens shared across apps. Colours are chosen to hit WCAG AA
 * contrast (>=4.5:1 for normal text, AAA >=7:1 for body text) against
 * `paper`. Sizes follow the "seniors and non-tech-savvy staff" accessibility
 * bar from CLAUDE.md: 18px base text, >=48px touch targets, 72px primary
 * action height. Keep in sync with `tokens.css`.
 */
export const colors = {
  ink: "#15212a",
  paper: "#f8f6ee",
  surface: "#ffffff",
  border: "#cbd2d9",
  primary: "#0e4a67",
  primaryContrast: "#ffffff",
  success: "#15803d",
  warning: "#b45309",
  danger: "#b91c1c",
} as const;

/** Status colours, each meant to always be paired with a text label. */
export const statusColors = {
  working: { fg: "#15803d", bg: "#dcfce7" },
  break: { fg: "#b45309", bg: "#fef3c7" },
  off: { fg: "#44515c", bg: "#e6e9ec" },
  error: { fg: "#b91c1c", bg: "#fee2e2" },
} as const;

export const typography = {
  baseFontSizePx: 18,
  largeFontSizePx: 20,
  xlFontSizePx: 24,
  xxlFontSizePx: 28,
  statusFontSizePx: 40,
  otpFontSizePx: 32,
} as const;

export const sizing = {
  minTouchTargetPx: 48,
  buttonLgHeightPx: 56,
  primaryActionHeightPx: 72,
  bottomNavHeightPx: 64,
  kioskTilePx: 96,
  pinKeyPx: 80,
} as const;

export const radius = {
  smPx: 6,
  mdPx: 10,
  lgPx: 16,
} as const;

export const focusRing = {
  widthPx: 3,
} as const;

export const tokens = {
  colors,
  statusColors,
  typography,
  sizing,
  radius,
  focusRing,
} as const;

export type Tokens = typeof tokens;
