"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { ShiftTags } from "../clock/ShiftTags";
import { buttonClassName } from "../ui/Button";
import { GroupedList, ListButtonRow, ListRow } from "../ui/GroupedList";
import { Sheet } from "../ui/Sheet";

/** One shift, already formatted on the server (plain data crosses to the client). */
export interface HoursRow {
  key: string;
  /** "ma 28 sep". */
  date: string;
  /** "maandag 28 september 2026", the sheet title. */
  longDate: string;
  range: string;
  pause: string;
  net: string;
  edited: boolean;
  offline: boolean;
  offlineSkew: string | null;
  /** "Klopt er iets niet?" starts a question for this day. */
  correctionHref: string;
}

export interface HoursListProps {
  heading: string;
  rows: readonly HoursRow[];
}

/** Days as a grouped list; tapping one opens its detail and "Klopt er iets niet?". */
export function HoursList({ heading, rows }: HoursListProps) {
  const [selected, setSelected] = useState<HoursRow | null>(null);

  return (
    <>
      <GroupedList heading={heading}>
        {rows.map((row) => (
          <ListButtonRow
            key={row.key}
            aria-haspopup="dialog"
            title={row.date}
            detail={
              <ShiftTags range={row.range} edited={row.edited} offline={row.offline} />
            }
            value={row.net}
            chevron
            onClick={() => setSelected(row)}
          />
        ))}
      </GroupedList>
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.longDate ?? ""}
      >
        {selected ? (
          <div className="flex flex-col gap-6">
            <GroupedList>
              <ListRow
                title={t("hours.detailTime")}
                value={
                  <ShiftTags
                    range={selected.range}
                    edited={selected.edited}
                    offline={selected.offline}
                  />
                }
              />
              <ListRow title={t("hours.detailPause")} value={selected.pause} />
              <ListRow title={t("hours.detailNet")} value={selected.net} />
            </GroupedList>
            {selected.offlineSkew ? (
              <p className="text-subhead text-ink-2">
                {t("hours.detailOfflineSkew", { value: selected.offlineSkew })}
              </p>
            ) : null}
            <Link
              href={selected.correctionHref as Route}
              className={buttonClassName("secondary", "md", true)}
            >
              {t("hours.somethingWrong")}
            </Link>
          </div>
        ) : null}
      </Sheet>
    </>
  );
}
