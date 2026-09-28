import { t } from "@cloxa/i18n";

import { nowMs } from "@/lib/clock/now";
import { recentMonths } from "@/lib/exports/brussels";

import { buttonClassName } from "../ui/Button";
import { Field } from "../ui/Field";

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
 * "Download mijn uren (CSV)" for a chosen month. A plain GET form, so it
 * works without JavaScript; the route checks the session and audits.
 */
export function SelfExportLink() {
  const months = recentMonths(nowMs(), MONTHS_SHOWN);

  return (
    <form
      action="/app/uren/export"
      method="get"
      className="flex flex-wrap items-end gap-3"
    >
      <Field id="self-export-month" label={t("exports.selfMonthLabel")}>
        <select
          name="maand"
          defaultValue={months[0]}
          className="focus-ring min-h-touch-target rounded-md border-2 border-border bg-surface px-4 text-lg text-ink"
        >
          {months.map((month) => (
            <option key={month} value={month}>
              {monthLabel(month)}
            </option>
          ))}
        </select>
      </Field>
      <button type="submit" className={buttonClassName("secondary", "md")}>
        {t("exports.selfDownload")}
      </button>
    </form>
  );
}
