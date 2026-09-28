import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";

export interface ScheduleBlockRow {
  readonly day: string;
  readonly start_at: string;
  readonly end_at: string;
}

/**
 * Planned blocks (from `rpc_schedule_for`) for one week, grouped per day, in
 * Brussels time. Used on `/app/uren`'s "Mijn rooster" section.
 */
export function ScheduleBlocksList({ rows }: { rows: readonly ScheduleBlockRow[] }) {
  if (rows.length === 0) {
    return <p className="text-ink/70">{t("schedule.myScheduleNoBlocks")}</p>;
  }

  return (
    <ul className="flex flex-col gap-1">
      {rows.map((row, index) => (
        <li key={index} className="text-ink/70">
          {t("schedule.myScheduleDayRow", {
            date: formatBrusselsDate(new Date(row.start_at)),
            range: `${formatBrusselsTime(new Date(row.start_at))}–${formatBrusselsTime(new Date(row.end_at))}`,
          })}
        </li>
      ))}
    </ul>
  );
}
