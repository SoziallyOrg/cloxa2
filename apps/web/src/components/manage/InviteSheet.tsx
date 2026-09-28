"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { Sheet } from "../ui/Sheet";
import { InviteForm, type InviteFormProps } from "./InviteForm";

/** "Medewerker uitnodigen": the team page's one primary action, in a sheet. */
export function InviteSheet(props: InviteFormProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t("manageTeam.inviteButton")}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manageTeam.inviteHeading")}
      >
        <InviteForm {...props} />
      </Sheet>
    </>
  );
}
