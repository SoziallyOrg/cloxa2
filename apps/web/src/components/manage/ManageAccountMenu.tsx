"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import { SessionRows } from "../auth/SessionActions";
import { cx } from "../ui/cx";
import { GroupedList, ListLinkRow } from "../ui/GroupedList";
import { Sheet } from "../ui/Sheet";

export interface ManageAccountMenuProps {
  /** "Mia T.": the visible trigger. */
  shortName: string;
  /** The sheet's title. */
  fullName: string;
  /** A manager who is also an employee gets "Naar mijn klok". */
  showSwitchToEmployee: boolean;
  placement: "header" | "sidebar";
}

// The manager area never queues clock actions on the device.
const nothingQueued = async () => 0;

/**
 * The manager's name; it opens the account sheet: to the own clock,
 * Beveiliging, and sign-out.
 */
export function ManageAccountMenu({
  shortName,
  fullName,
  showSwitchToEmployee,
  placement,
}: ManageAccountMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={cx(
          "focus-ring min-h-touch-target rounded-control text-body",
          placement === "header"
            ? "-mr-3 px-3 text-ink-2 hover:text-ink"
            : "w-full px-3 text-left text-ink-2 hover:bg-fill hover:text-ink",
        )}
      >
        {shortName}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={fullName}
        description={t("manageNav.accountHint")}
      >
        <div className="flex flex-col gap-6">
          <GroupedList>
            {showSwitchToEmployee ? (
              <ListLinkRow href="/app" title={t("manageNav.switchToEmployee")} />
            ) : null}
            <ListLinkRow
              href="/manage/beveiliging/instellen"
              title={t("manageNav.security")}
            />
          </GroupedList>
          <SessionRows queuedCount={nothingQueued} />
        </div>
      </Sheet>
    </>
  );
}
