/**
 * Design tokens shared across apps: direction C with the iOS-fidelity layer
 * (docs/design.md). Keep in sync with `tokens.css`; `tokens.test.ts` checks
 * the contrast pairs below stay at WCAG AA.
 *
 * - `ink` is the label colour and the primary action. `ink2` (secondary
 *   label) stays >= 4.5:1 on every background; `ink3` (tertiary) is for
 *   18px+ or non-essential text only (>= 3:1).
 * - `grouped` is the iOS grouped page background, `surface` the rows on it.
 * - Status colours follow the iOS high-contrast system palette, tuned so
 *   text reaches AA on every background (sheets and alerts included). Dark
 *   mode uses the iOS dark tints (the accessible red).
 */
export const colors = {
  light: {
    ink: "#0a0a0a",
    ink2: "#6c6c70",
    ink3: "#8a8a8e",
    paper: "#ffffff",
    fill: "#f5f5f7",
    line: "#e8e8ea",
    grouped: "#f2f2f7",
    surface: "#ffffff",
    /** Inside sheets; dark mode lifts both one step, as iOS does. */
    groupedElevated: "#f2f2f7",
    surfaceElevated: "#ffffff",
    /** iOS opaque separator; drawn as a hairline. */
    separator: "#c6c6c8",
    /** Row background while pressed (iOS systemGray4). */
    pressed: "#d1d1d6",
    /** Switch off track; segmented-control thumb. */
    track: "#e9e9eb",
    thumb: "#ffffff",
    working: "#207936",
    break: "#b25000",
    attention: "#c93400",
    danger: "#d70015",
  },
  dark: {
    ink: "#f5f5f5",
    ink2: "#98989f",
    ink3: "#7c7c80",
    paper: "#000000",
    fill: "#1c1c1e",
    line: "#2c2c2e",
    grouped: "#000000",
    surface: "#1c1c1e",
    groupedElevated: "#1c1c1e",
    surfaceElevated: "#2c2c2e",
    separator: "#38383a",
    pressed: "#3a3a3c",
    track: "#39393d",
    thumb: "#636366",
    working: "#30d158",
    break: "#ffd60a",
    attention: "#ff9f0a",
    danger: "#ff6961",
  },
} as const;

/**
 * Soft status tints for dots' halos and quiet backgrounds (12% light, 22%
 * dark). Never behind status text that must reach AA on its own.
 */
export const statusTints = {
  light: {
    working: "rgb(32 121 54 / 0.12)",
    break: "rgb(178 80 0 / 0.12)",
    attention: "rgb(201 52 0 / 0.12)",
    danger: "rgb(215 0 21 / 0.12)",
  },
  dark: {
    working: "rgb(48 209 88 / 0.22)",
    break: "rgb(255 214 10 / 0.22)",
    attention: "rgb(255 159 10 / 0.22)",
    danger: "rgb(255 105 97 / 0.22)",
  },
} as const;

/**
 * Settings-style icon tiles: a white glyph on a coloured rounded square.
 * Each stays >= 3:1 against white (WCAG 1.4.11, graphical objects).
 */
export const tileColors = {
  gray: "#8e8e93",
  ink: "#3a3a3c",
  blue: "#007aff",
  green: "#207936",
  orange: "#c93400",
  red: "#d70015",
} as const;

export type TileColor = keyof typeof tileColors;

/**
 * Translucent bar materials (nav bar, tab bar, sidebar). Always drawn with
 * `backdrop-filter: saturate(180%) blur(blurPx)`.
 */
export const materials = {
  blurPx: 20,
  saturatePercent: 180,
  light: {
    bar: "rgb(249 249 249 / 0.8)",
    sidebar: "rgb(242 242 247 / 0.82)",
    sheet: "rgb(255 255 255 / 0.9)",
  },
  dark: {
    bar: "rgb(22 22 23 / 0.8)",
    sidebar: "rgb(28 28 30 / 0.82)",
    sheet: "rgb(30 30 32 / 0.9)",
  },
} as const;

/** Every tappable dims to this opacity while pressed (no hover-only cues). */
export const pressedOpacity = 0.6;

/**
 * SF-like everywhere: San Francisco on Apple devices, self-hosted Inter
 * (variable, OFL) elsewhere.
 */
export const fontStack =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter Variable", system-ui, sans-serif';

/**
 * The iOS text styles (size / line height in px, weight). `display` (the
 * timer) and `number` (KPIs) are Cloxa's own. Numbers always use tabular
 * figures.
 */
export const textStyles = {
  largeTitle: { sizePx: 34, lineHeightPx: 41, weight: 700 },
  title1: { sizePx: 28, lineHeightPx: 34, weight: 400 },
  title2: { sizePx: 22, lineHeightPx: 28, weight: 400 },
  title3: { sizePx: 20, lineHeightPx: 25, weight: 400 },
  headline: { sizePx: 17, lineHeightPx: 22, weight: 600 },
  body: { sizePx: 17, lineHeightPx: 22, weight: 400 },
  callout: { sizePx: 16, lineHeightPx: 21, weight: 400 },
  subhead: { sizePx: 15, lineHeightPx: 20, weight: 400 },
  footnote: { sizePx: 13, lineHeightPx: 18, weight: 400 },
  caption: { sizePx: 12, lineHeightPx: 16, weight: 400 },
  caption2: { sizePx: 11, lineHeightPx: 13, weight: 500 },
  display: { sizePx: 88, lineHeightPx: 88, weight: 300 },
  number: { sizePx: 34, lineHeightPx: 37, weight: 500 },
} as const;

export const sizing = {
  minTouchTargetPx: 48,
  /** iOS bar buttons and icon buttons. */
  barButtonPx: 44,
  controlHeightPx: 52,
  listRowMinHeightPx: 56,
  /** Inset grouped rows: one line / two lines. */
  rowPx: 44,
  rowTwoLinePx: 52,
  iconTilePx: 29,
  primaryActionHeightPx: 72,
  navBarPx: 44,
  tabBarHeightPx: 50,
  sidebarPx: 260,
  readableColumnPx: 720,
  kioskTilePx: 120,
  pinKeyPx: 88,
} as const;

export const spacing = {
  basePx: 4,
  gutterPhonePx: 24,
  gutterDesktopPx: 40,
  /** iOS inset grouped lists sit 16px from the screen edge. */
  insetPx: 16,
  sectionGapPx: 32,
} as const;

export const radius = {
  controlPx: 14,
  groupPx: 16,
  /** Inset grouped lists. */
  listPx: 10,
  tilePx: 7,
  sheetPx: 14,
  alertPx: 14,
} as const;

export const focusRing = {
  widthPx: 3,
  offsetPx: 2,
} as const;

export const tokens = {
  colors,
  statusTints,
  tileColors,
  materials,
  pressedOpacity,
  fontStack,
  textStyles,
  sizing,
  spacing,
  radius,
  focusRing,
} as const;

export type Tokens = typeof tokens;
