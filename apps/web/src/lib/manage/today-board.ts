/**
 * Pure presentation rules for the Vandaag board (docs/design.md, "Day
 * timeline"): which status group a person is in, what colour their bar has,
 * which side-panel tab is showing. No I/O; the attention and count rules
 * themselves stay in `attention.ts` and `board-counts.ts`.
 */
export type StatusGroup = "working" | "break" | "attention" | "idle";

/** Phones list groups in this order; an empty group is left out. */
export const GROUP_ORDER: readonly StatusGroup[] = [
  "working",
  "break",
  "attention",
  "idle",
];

export interface GroupInput {
  /** A shift is open right now. */
  readonly open: boolean;
  readonly onBreak: boolean;
  readonly hasAttention: boolean;
}

/** Attention wins over everything: it is the one thing the manager must see. */
export function statusGroup(input: GroupInput): StatusGroup {
  if (input.hasAttention) return "attention";
  if (input.open) return input.onBreak ? "break" : "working";
  return "idle";
}

export type TrackTone = "working" | "done" | "attention";

/**
 * Forest while working, grey once finished, red when an open shift needs
 * attention (forgotten clock-out, long break). Breaks are always amber.
 */
export function trackTone(input: { open: boolean; hasAttention: boolean }): TrackTone {
  if (!input.open) return "done";
  return input.hasAttention ? "attention" : "working";
}

export function groupPeople<T extends { readonly group: StatusGroup }>(
  people: readonly T[],
): { group: StatusGroup; people: T[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    people: people.filter((person) => person.group === group),
  })).filter((entry) => entry.people.length > 0);
}

export type PanelTabId = "person" | "requests";

/**
 * Which side-panel tab shows. A tab the user picked stays. Otherwise a
 * selected person shows "Medewerker"; with nobody selected, waiting
 * requests come first, else "Medewerker" with its hint.
 */
export function activePanelTab(input: {
  choice: PanelTabId | null;
  selectedId: string | null;
  pendingCount: number;
}): PanelTabId {
  if (input.choice !== null) return input.choice;
  if (input.selectedId !== null) return "person";
  return input.pendingCount > 0 ? "requests" : "person";
}

export interface TileChange {
  readonly beforeLabel: string | null;
  readonly afterLabel: string | null;
}

/**
 * The "Was" and "Wordt" tiles of a correction request: the times before and
 * after, joined ("12:00–12:30"). `null` means nothing there ("geen" for was,
 * "verwijderd" for wordt); the caller words it.
 */
export function requestTiles(changes: readonly TileChange[]): {
  was: string | null;
  wordt: string | null;
} {
  const join = (labels: readonly (string | null)[]) => {
    const present = labels.filter((label): label is string => label !== null);
    return present.length === 0 ? null : present.join("–");
  };
  return {
    was: join(changes.map((change) => change.beforeLabel)),
    wordt: join(changes.map((change) => change.afterLabel)),
  };
}
