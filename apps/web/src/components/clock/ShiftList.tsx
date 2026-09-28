import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";
import type { Shift } from "@cloxa/domain";

import { EmptyState } from "../ui/EmptyState";
import { formatShiftRow } from "./shift-row";

export interface ShiftListProps {
  shifts: readonly Shift[];
  /** When given, each row gets a "Klopt er iets niet?" link, e.g. to start a correction. */
  correctionHref?: (shift: Shift, index: number) => string;
}

/** Day rows: date, start-end, pause, net, and "aangepast" / "offline" badges. */
export function ShiftList({ shifts, correctionHref }: ShiftListProps) {
  if (shifts.length === 0) {
    return <EmptyState title={t("shifts.emptyTitle")} body={t("shifts.emptyBody")} />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {shifts.map((shift, index) => {
        const row = formatShiftRow(shift);

        return (
          <li
            key={`${shift.start}-${index}`}
            className="flex flex-col gap-1 rounded-lg border border-border p-4 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex flex-col gap-1">
              <span className="font-semibold">{row.date}</span>
              <span className="text-ink/70">{row.range}</span>
            </div>
            <div className="flex flex-col gap-1 text-ink/70 sm:flex-row sm:items-center sm:gap-6">
              <span className="whitespace-nowrap">
                {t("shifts.pauseValue", { value: row.pause })}
              </span>
              <span className="font-semibold whitespace-nowrap text-ink">
                {t("shifts.netValue", { value: row.net })}
              </span>
              {row.edited ? (
                <span className="rounded-md bg-status-off-bg px-2 py-1 text-base font-semibold text-status-off">
                  {t("shifts.edited")}
                </span>
              ) : null}
              {row.offline ? (
                <span className="rounded-md bg-status-off-bg px-2 py-1 text-base font-semibold text-status-off">
                  {t("offline.shiftBadge")}
                </span>
              ) : null}
              {correctionHref ? (
                <Link
                  href={correctionHref(shift, index) as Route}
                  className="focus-ring font-semibold whitespace-nowrap text-primary underline"
                >
                  {t("hours.somethingWrong")}
                </Link>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
