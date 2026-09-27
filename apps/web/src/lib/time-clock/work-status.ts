import type { TimeClockView } from "./model";
import { formatBelgianTime } from "./format";

export type WorkState = Pick<TimeClockView, "status" | "currentStartedAt">;
export function workStatusLabel(clock: WorkState | null, loading = false) {
  if (loading) return "Werkstatus wordt gecontroleerd…";
  if (!clock) return "Werkstatus niet beschikbaar";
  if (clock.status === "on_break") return "Met pauze";
  if (clock.status === "working")
    return clock.currentStartedAt
      ? `Aan het werk · gestart om ${formatBelgianTime(clock.currentStartedAt)}`
      : "Werkstatus niet beschikbaar";
  return "Niet aan het werk";
}
