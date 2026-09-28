"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import type { PinActionResult } from "@/lib/kiosk/pin";

import { PinForm } from "../kiosk/PinForm";
import { ListButtonRow } from "../ui/GroupedList";
import { Sheet } from "../ui/Sheet";

export interface PinRowProps {
  employeeName: string;
  /** "Pincode ingesteld op 3 september 2026." or "Nog geen pincode." */
  state: string;
  action: (input: { pin: string; confirmation: string }) => Promise<PinActionResult>;
}

/** The kiosk PIN as one row; setting a new one happens in a sheet. */
export function PinRow({ employeeName, state, action }: PinRowProps) {
  const [open, setOpen] = useState(false);

  return (
    <ListButtonRow
      title={t("manageEmployee.pinButton")}
      detail={state}
      chevron
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      sheet={
        <Sheet
          open={open}
          onClose={() => setOpen(false)}
          title={t("manageEmployee.pinSheetTitle", { name: employeeName })}
          description={t("kiosk.pinSettingsIntro")}
        >
          <PinForm
            id="employee-pin"
            submitLabel={t("kiosk.managerPinSubmit")}
            savedMessage={t("kiosk.managerPinSaved")}
            action={action}
          />
        </Sheet>
      }
    />
  );
}
