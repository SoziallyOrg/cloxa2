"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { queuedCountFor } from "@/lib/offline/browser";

import { SessionActions } from "../auth/SessionActions";
import { buttonClassName } from "../ui/Button";
import { cx } from "../ui/cx";
import { Sheet } from "../ui/Sheet";

export interface AccountMenuProps {
  employeeId: string;
  /** "Jan J.": the visible trigger. */
  shortName: string;
  /** The sheet's title. */
  fullName: string;
  /** Where the trigger sits: the phone header or the desktop sidebar. */
  placement: "header" | "sidebar";
}

/**
 * The first name and initial; tapping it opens the account sheet with
 * Instellingen and sign-out. The queued-action count is read when the sheet
 * opens, so the sign-out warning is current.
 */
export function AccountMenu({
  employeeId,
  shortName,
  fullName,
  placement,
}: AccountMenuProps) {
  const [open, setOpen] = useState(false);
  const [queued, setQueued] = useState(0);

  async function openSheet() {
    setQueued(await queuedCountFor(employeeId));
    setOpen(true);
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => void openSheet()}
        className={cx(
          "focus-ring min-h-touch-target rounded-control text-body",
          placement === "header"
            ? "-mr-3 px-3 text-ink-2 hover:text-ink"
            : "w-full px-3 text-left text-ink-2 hover:bg-fill hover:text-ink",
        )}
      >
        {shortName}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={fullName}>
        <div className="flex flex-col gap-3">
          <Link
            href={"/app/instellingen" as Route}
            onClick={() => setOpen(false)}
            className={buttonClassName("secondary", "md", true)}
          >
            {t("account.settings")}
          </Link>
          <SessionActions everywhere pendingCount={queued} />
        </div>
      </Sheet>
    </>
  );
}
