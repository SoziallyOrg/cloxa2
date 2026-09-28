/**
 * Design tokens shared across apps, direction C (docs/design.md). Keep in
 * sync with `tokens.css`. `ink-2` stays >= 4.5:1 on `paper` and `fill`;
 * `ink-3` is for 18px+ or non-essential text only.
 */
export const colors = {
  light: {
    ink: "#0a0a0a",
    ink2: "#5c5c5c",
    ink3: "#8a8a8a",
    paper: "#ffffff",
    fill: "#f5f5f7",
    line: "#e8e8ea",
    working: "#15803d",
    break: "#b45309",
    attention: "#c2410c",
    danger: "#b91c1c",
  },
  dark: {
    ink: "#f5f5f5",
    ink2: "#a3a3a3",
    ink3: "#737373",
    paper: "#000000",
    fill: "#1c1c1e",
    line: "#2c2c2e",
    working: "#4ade80",
    break: "#fbbf24",
    attention: "#fb923c",
    danger: "#f87171",
  },
} as const;

export const fontStack =
  '-apple-system, "SF Pro Text", "Segoe UI Variable Text", Roboto, system-ui, sans-serif';

/** Size in px and weight; numbers always use tabular figures. */
export const typography = {
  display: { sizePx: 88, weight: 300 },
  title: { sizePx: 32, weight: 600 },
  headline: { sizePx: 22, weight: 600 },
  body: { sizePx: 17, weight: 400 },
  callout: { sizePx: 15, weight: 400 },
  number: { sizePx: 34, weight: 500 },
} as const;

export const sizing = {
  minTouchTargetPx: 48,
  controlHeightPx: 52,
  listRowMinHeightPx: 56,
  primaryActionHeightPx: 72,
  tabBarHeightPx: 64,
  kioskTilePx: 120,
  pinKeyPx: 88,
} as const;

export const spacing = {
  basePx: 4,
  gutterPhonePx: 24,
  gutterDesktopPx: 40,
  sectionGapPx: 32,
} as const;

export const radius = {
  controlPx: 14,
  groupPx: 16,
} as const;

export const focusRing = {
  widthPx: 3,
  offsetPx: 2,
} as const;

export const tokens = {
  colors,
  fontStack,
  typography,
  sizing,
  spacing,
  radius,
  focusRing,
} as const;

export type Tokens = typeof tokens;
