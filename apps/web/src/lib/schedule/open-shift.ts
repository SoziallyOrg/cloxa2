/**
 * Which planned blocks belong to a shift that is open right now. A night
 * shift started at 21:30 belongs to yesterday's block (21:30–06:00), not to
 * anything planned "today". Pure: instants in, instants out.
 */
export interface Block {
  readonly start: number;
  readonly end: number;
}

// People clock in a bit early; a block that starts within this margin after
// the actual start still counts as theirs.
const EARLY_START_TOLERANCE_MS = 4 * 3600 * 1000;

/** Blocks still running at `startedAt` (or starting shortly after it). */
export function blocksForOpenShift<T extends Block>(
  startedAt: number,
  blocks: readonly T[],
): T[] {
  return blocks.filter(
    (block) =>
      block.end > startedAt && block.start - EARLY_START_TOLERANCE_MS <= startedAt,
  );
}

/** When the open shift was supposed to end, or `null` without a schedule. */
export function plannedEndForOpenShift(
  startedAt: number,
  blocks: readonly Block[],
): number | null {
  const matching = blocksForOpenShift(startedAt, blocks);
  return matching.length === 0 ? null : Math.max(...matching.map((block) => block.end));
}
