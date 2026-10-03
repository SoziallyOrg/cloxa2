"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { t } from "@cloxa/i18n";

import { NavBarButton } from "../ui/NavBar";
import { Sheet } from "../ui/Sheet";
import { InviteForm, type InviteFormProps } from "./InviteForm";

/**
 * "Uitnodigen" in the navigation bar; the form lives in a sheet. A sent
 * invitation lands on the Uitgenodigd segment, where it can be revoked.
 */
export function InviteSheet(props: Omit<InviteFormProps, "onSent">) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <NavBarButton strong aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {t("manageTeam.inviteAction")}
      </NavBarButton>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manageTeam.inviteHeading")}
        detent="large"
        closeLabel={t("ui.cancel")}
      >
        <InviteForm
          {...props}
          onSent={() => {
            setOpen(false);
            router.push("/manage/team?toon=uitgenodigd&verstuurd=1" as Route);
          }}
        />
      </Sheet>
    </>
  );
}
