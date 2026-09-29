"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { ShiftTags } from "../clock/ShiftTags";
import { buttonClassName } from "../ui/Button";
import { Row, Section } from "../ui/List";
import { Sheet } from "../ui/Sheet";
import { PUSH } from "../ui/transitions";

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
  /** Worked at home (telework module). */
  home: boolean;
  offlineSkew: string | null;
  /** "Klopt er iets niet?" starts a question for this day. */
  correctionHref: string;
}

export interface HoursListProps {
  heading: string;
  rows: readonly HoursRow[];
}

/** The quiet notes under a day's detail: "aangepast", "offline", the sync delay. */
function detailNotes(row: HoursRow): string | null {
  const notes = [
    row.edited ? t("shifts.edited") : null,
    row.offlineSkew
      ? t("hours.detailOfflineSkew", { value: row.offlineSkew })
      : row.offline
        ? t("offline.shiftBadge")
        : null,
  ].filter((note): note is string => note !== null);
  return notes.length > 0 ? notes.join(" · ") : null;
}

/** Days as an inset grouped list; tapping one opens its detail sheet. */
export function HoursList({ heading, rows }: HoursListProps) {
  const [selected, setSelected] = useState<HoursRow | null>(null);

  return (
    <>
      <Section header={heading}>
        {rows.map((row) => (
          <Row
            key={row.key}
            aria-haspopup="dialog"
            title={row.date}
            subtitle={
              <ShiftTags
                range={row.range}
                edited={row.edited}
                offline={row.offline}
                home={row.home}
              />
            }
            value={row.net}
            chevron
            onClick={() => setSelected(row)}
          />
        ))}
      </Section>
      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.longDate ?? ""}
      >
        {selected ? (
          <>
            <Section footer={detailNotes(selected)}>
              <Row title={t("hours.detailTime")} value={selected.range} />
              <Row title={t("hours.detailPause")} value={selected.pause} />
              <Row title={t("hours.detailNet")} value={selected.net} />
            </Section>
            <Link
              href={selected.correctionHref as Route}
              transitionTypes={PUSH}
              className={buttonClassName("primary", "md", true)}
            >
              {t("hours.somethingWrong")}
            </Link>
          </>
        ) : null}
      </Sheet>
    </>
  );
}
