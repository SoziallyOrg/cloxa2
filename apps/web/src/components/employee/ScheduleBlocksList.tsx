import { formatBrusselsShortDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { GroupedList, ListRow } from "../ui/GroupedList";

export interface ScheduleBlockRow {
  readonly day: string;
  readonly start_at: string;
  readonly end_at: string;
}

/**
 * Planned blocks (from `rpc_schedule_for`) for one week, in Brussels time.
 * Used on `/app/uren`'s "Mijn rooster" section.
 */
export function ScheduleBlocksList({
  heading,
  rows,
  testId,
}: {
  heading: string;
  rows: readonly ScheduleBlockRow[];
  testId: string;
}) {
  return (
    <GroupedList heading={heading} headingLevel={3} data-testid={testId}>
      {rows.length === 0 ? (
        <ListRow title={t("schedule.myScheduleNoBlocks")} />
      ) : (
        rows.map((row, index) => (
          <ListRow
            key={index}
            title={formatBrusselsShortDate(new Date(row.start_at))}
            value={`${formatBrusselsTime(new Date(row.start_at))}–${formatBrusselsTime(new Date(row.end_at))}`}
          />
        ))
      )}
    </GroupedList>
  );
}
