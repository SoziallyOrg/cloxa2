/**
 * Geometry of the CRing: the logo's open "c" as a 270° arc in a 260 box, gap
 * on the right, the "now" dot in the gap. Pure, so it is easy to test.
 */

const CENTER = 130;
const RADIUS = 105;
const SWEEP_DEG = 270;
/** The arc starts at the top of the gap: -45° (upper right) and runs counterclockwise. */
const START_DEG = -45;

const fix = (value: number) => value.toFixed(1);

export interface CRingGeometry {
  /** The full 270° track. */
  trackPath: string;
  /** The worked part, or `null` when nothing is worked yet (nothing to draw). */
  progressPath: string | null;
  /** Where the progress arc ends (for tests and for placing marks). */
  end: { x: number; y: number };
  strokeWidth: number;
  dotRadius: number;
  dot: { x: number; y: number };
  /** The progress that was drawn, clamped to 0-1. */
  progress: number;
}

export function clampProgress(progress: number): number {
  if (!Number.isFinite(progress)) return 0;
  return Math.min(1, Math.max(0, progress));
}

/** Small rings (clock bar) get a thicker stroke and a bigger dot so they stay legible. */
export function cringGeometry(progress: number, size: number): CRingGeometry {
  const p = clampProgress(progress);
  const small = size < 80;
  const angle = ((START_DEG - SWEEP_DEG * p) * Math.PI) / 180;
  const x = CENTER + RADIUS * Math.cos(angle);
  const y = CENTER + RADIUS * Math.sin(angle);
  const large = SWEEP_DEG * p > 180 ? 1 : 0;

  return {
    trackPath: `M204.2 55.8A${RADIUS} ${RADIUS} 0 1 0 204.2 204.2`,
    progressPath:
      p === 0
        ? null
        : `M204.2 55.8A${RADIUS} ${RADIUS} 0 ${large} 0 ${fix(x)} ${fix(y)}`,
    end: { x: Number(fix(x)), y: Number(fix(y)) },
    strokeWidth: small ? 30 : 24,
    dotRadius: small ? 22 : 17,
    dot: { x: 235, y: CENTER },
    progress: p,
  };
}
