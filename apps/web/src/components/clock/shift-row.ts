/** Pure formatting for one `ShiftList` row. */
import { formatBrusselsShortDate, formatBrusselsTime, t } from "@cloxa/i18n";
import type { Shift } from "@cloxa/domain";

import { formatDurationMs } from "./format";

export interface ShiftRow {
  readonly date: string;
  /** "08:00–12:30", or ending in the "nog bezig" label while the shift is open. */
  readonly range: string;
  readonly pause: string;
  readonly net: string;
  readonly edited: boolean;
}

export function formatShiftRow(shift: Shift): ShiftRow {
  const start = formatBrusselsTime(new Date(shift.start));
  const end =
    shift.end !== null ? formatBrusselsTime(new Date(shift.end)) : t("shifts.openEnd");

  return {
    date: formatBrusselsShortDate(new Date(shift.start)),
    range: `${start}–${end}`,
    pause: formatDurationMs(shift.breakMs),
    net: formatDurationMs(shift.netMs),
    edited: shift.edited,
  };
}
