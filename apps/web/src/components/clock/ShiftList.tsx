import { t } from "@cloxa/i18n";
import type { Shift } from "@cloxa/domain";

import { EmptyState } from "../ui/EmptyState";
import { GroupedList, ListRow } from "../ui/GroupedList";
import { formatShiftRow } from "./shift-row";
import { ShiftTags } from "./ShiftTags";

export interface ShiftListProps {
  shifts: readonly Shift[];
  /** Managers: show how late offline events reached the server. */
  showOfflineSkew?: boolean;
}

/** Read-only shift rows (managers): date, start–end and net, with tags. */
export function ShiftList({ shifts, showOfflineSkew = false }: ShiftListProps) {
  if (shifts.length === 0) {
    return <EmptyState title={t("shifts.emptyTitle")} body={t("shifts.emptyBody")} />;
  }

  return (
    <GroupedList>
      {shifts.map((shift, index) => {
        const row = formatShiftRow(shift);
        return (
          <ListRow
            key={`${shift.start}-${index}`}
            title={row.date}
            detail={
              <ShiftTags
                range={row.range}
                edited={row.edited}
                offline={row.offline}
                extra={
                  showOfflineSkew && row.offlineSkew
                    ? t("offline.skewLabel", { value: row.offlineSkew })
                    : null
                }
              />
            }
            value={row.net}
          />
        );
      })}
    </GroupedList>
  );
}
