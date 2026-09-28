import { ChevronsUpDown, Download } from "lucide-react";

import { t } from "@cloxa/i18n";

import { nowMs } from "@/lib/clock/now";
import { recentMonths } from "@/lib/exports/brussels";

import { Row, Section } from "../ui/List";

const MONTHS_SHOWN = 12;

const MONTH_LABEL = new Intl.DateTimeFormat("nl-BE", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function monthLabel(month: string): string {
  const [year = 0, monthNumber = 1] = month.split("-").map(Number);
  return MONTH_LABEL.format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

/**
 * "Download mijn uren (CSV)" for a chosen month, as a settings-style group:
 * the month as a native picker in a row, then the download row. A plain GET
 * form, so it works without JavaScript; the route checks the session and
 * audits.
 */
export function SelfExportLink({ heading }: { heading: string }) {
  const months = recentMonths(nowMs(), MONTHS_SHOWN);

  return (
    <form action="/app/uren/export" method="get">
      <Section header={heading}>
        <Row
          title={
            <label htmlFor="self-export-month">{t("exports.selfMonthLabel")}</label>
          }
          accessory={
            <span className="relative flex min-w-0 items-center">
              <select
                id="self-export-month"
                name="maand"
                defaultValue={months[0]}
                className="focus-ring min-h-touch-target max-w-48 min-w-0 appearance-none truncate rounded-md bg-transparent pr-6 pl-2 text-right text-body text-ink-2"
              >
                {months.map((month) => (
                  <option key={month} value={month}>
                    {monthLabel(month)}
                  </option>
                ))}
              </select>
              <ChevronsUpDown
                aria-hidden="true"
                className="pointer-events-none absolute right-0 size-4 text-ink-3"
                strokeWidth={2.25}
              />
            </span>
          }
        />
        <Row
          type="submit"
          icon={Download}
          tile="blue"
          title={t("exports.selfDownload")}
        />
      </Section>
    </form>
  );
}
