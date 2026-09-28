"use client";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";

export interface SignOutEverywhereFormProps {
  employeeId: string;
  employeeName: string;
  action: (formData: FormData) => Promise<void>;
}

/** A confirm step before signing an employee out of every device and org. */
export function SignOutEverywhereForm({
  employeeId,
  employeeName,
  action,
}: SignOutEverywhereFormProps) {
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(t("manageTeam.signOutConfirm", { name: employeeName }))) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="employeeId" value={employeeId} />
      <Button type="submit" variant="danger" size="md">
        {t("manageTeam.signOutEverywhere")}
      </Button>
    </form>
  );
}
