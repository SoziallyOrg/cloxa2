/**
 * Design tokens shared across apps. Colours are chosen to hit WCAG AA
 * contrast (>=4.5:1 for normal text) against `paper`. Sizes follow the
 * "seniors and non-tech-savvy staff" accessibility bar from CLAUDE.md:
 * 18px base text, >=48px touch targets, 72px primary action height.
 */
export const colors = {
  ink: "#15212a",
  paper: "#f8f6ee",
  primary: "#0e4a67",
  success: "#15803d",
  warning: "#b45309",
  danger: "#b91c1c",
} as const;

export const typography = {
  baseFontSizePx: 18,
} as const;

export const sizing = {
  minTouchTargetPx: 48,
  primaryActionHeightPx: 72,
} as const;

export const tokens = {
  colors,
  typography,
  sizing,
} as const;

export type Tokens = typeof tokens;
