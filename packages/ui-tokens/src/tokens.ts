/**
 * Design tokens shared across apps: identity D, "Signaal + ring"
 * (docs/design.md). Keep in sync with `tokens.css`; `tokens.test.ts` checks
 * the contrast pairs below stay at WCAG AA.
 *
 * - Light only: the forest surfaces are the "dark" of the brand.
 * - `lime` is only ever a background with `forestDeep` text, or a dot.
 * - `ink2` (secondary text) stays >= 4.5:1 on paper and card; `ink3` is for
 *   18px+ text, icons and non-essential text (>= 3:1).
 * - `danger` is the text/button red (white on it >= 4.5:1); `dangerBar` is the
 *   brighter red of timeline bars and dots, never behind small text.
 */
export const colors = {
  light: {
    ink: "#10231b",
    ink2: "#5f6b64",
    ink3: "#78837c",
    paper: "#f5f6f1",
    card: "#ffffff",
    line: "#e2e5dc",
    fill: "#edefe7",
    track: "#edefe7",
    /** Container of the toggle / tabs; the active segment is `thumb`. */
    toggle: "#e6e9df",
    thumb: "#ffffff",
    /** Input borders. */
    field: "#7f8a83",
    forest: "#0e4a33",
    forestDeep: "#0a3626",
    lime: "#b5f04e",
    leaf: "#1fa855",
    onForest2: "#b7d2c4",
    idle: "#dde1d6",
    idleBar: "#aeb6ad",
    working: "#0e4a33",
    /** The pause block. Text on it is `breakInk`. */
    break: "#f6c453",
    breakInk: "#6b4a00",
    attention: "#bf3623",
    danger: "#bf3623",
    dangerBar: "#d8432e",
    dangerTint: "#fce4de",
    dangerTintInk: "#6f1e12",
  },
} as const;

/** Soft status tints, never behind status text that must reach AA on its own. */
export const statusTints = {
  light: {
    working: "rgb(14 74 51 / 0.1)",
    break: "rgb(246 196 83 / 0.3)",
    attention: "#fce4de",
    danger: "#fce4de",
  },
} as const;

/** Every tappable dims to this opacity (and scales to 0.98) while pressed. */
export const pressedOpacity = 0.85;

/** Bricolage Grotesque Variable, self-hosted (`@fontsource-variable`). */
export const fontStack = '"Bricolage Grotesque Variable", system-ui, sans-serif';

/**
 * Text styles (size / line height in px, weight). `display` (the timer) and
 * `number` (stat blocks) are Cloxa's own. Numbers always use tabular figures.
 */
export const textStyles = {
  largeTitle: { sizePx: 36, lineHeightPx: 40, weight: 800 },
  title1: { sizePx: 30, lineHeightPx: 34, weight: 700 },
  title2: { sizePx: 24, lineHeightPx: 28, weight: 700 },
  title3: { sizePx: 20, lineHeightPx: 25, weight: 700 },
  section: { sizePx: 18, lineHeightPx: 24, weight: 700 },
  headline: { sizePx: 18, lineHeightPx: 23, weight: 700 },
  body: { sizePx: 18, lineHeightPx: 25, weight: 400 },
  callout: { sizePx: 17, lineHeightPx: 22, weight: 400 },
  subhead: { sizePx: 16, lineHeightPx: 21, weight: 400 },
  footnote: { sizePx: 14.5, lineHeightPx: 19, weight: 400 },
  caption: { sizePx: 13.5, lineHeightPx: 18, weight: 700 },
  caption2: { sizePx: 12.5, lineHeightPx: 16, weight: 600 },
  display: { sizePx: 88, lineHeightPx: 88, weight: 800 },
  number: { sizePx: 36, lineHeightPx: 40, weight: 700 },
} as const;

export const sizing = {
  minTouchTargetPx: 48,
  barButtonPx: 48,
  controlHeightPx: 56,
  listRowMinHeightPx: 56,
  /** Rows in a group: one line / two lines. */
  rowPx: 56,
  rowTwoLinePx: 64,
  /** The primary clock action. */
  primaryActionHeightPx: 72,
  navBarPx: 48,
  tabBarHeightPx: 68,
  sidebarPx: 244,
  sidebarIconsPx: 76,
  sidePanelPx: 330,
  readableColumnPx: 720,
  mainMaxPx: 1200,
  kioskTilePx: 120,
  pinKeyPx: 88,
} as const;

export const spacing = {
  basePx: 4,
  gutterPhonePx: 20,
  gutterDesktopPx: 32,
  insetPx: 16,
  sectionGapPx: 28,
} as const;

/** Buttons and nav items 12; cards and rows 14-20; clock block 20; hero 32. */
export const radius = {
  controlPx: 12,
  groupPx: 16,
  listPx: 16,
  cardPx: 18,
  sheetPx: 20,
  alertPx: 20,
  clockPx: 20,
  heroPx: 32,
} as const;

export const focusRing = {
  widthPx: 2,
  offsetPx: 2,
} as const;

export const tokens = {
  colors,
  statusTints,
  pressedOpacity,
  fontStack,
  textStyles,
  sizing,
  spacing,
  radius,
  focusRing,
} as const;

export type Tokens = typeof tokens;
