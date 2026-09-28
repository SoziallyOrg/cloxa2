"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { CopyLine } from "@/lib/manage/offboarding";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { ListButtonRow } from "../ui/GroupedList";
import { Sheet } from "../ui/Sheet";

type ActionResult = { readonly ok: boolean; readonly errorKey?: CatalogKey };

interface ConfirmRowProps {
  /** The row's label, also what the sheet is about. */
  rowTitle: string;
  danger: boolean;
  sheetTitle: string;
  /** Plain-language consequences, one per line. */
  lines: readonly string[];
  intro?: string;
  confirmLabel: string;
  action: () => Promise<ActionResult>;
}

/**
 * A grouped-list row that opens a sheet with the consequences; nothing
 * changes until the confirm button in the sheet.
 */
function ConfirmRow({
  rowTitle,
  danger,
  sheetTitle,
  lines,
  intro,
  confirmLabel,
  action,
}: ConfirmRowProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);

  async function confirm() {
    setSubmitting(true);
    setErrorKey(null);
    const result = await action();
    setSubmitting(false);
    if (!result.ok) {
      setErrorKey(result.errorKey ?? "manageEmployee.errorGeneric");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  return (
    <ListButtonRow
      title={rowTitle}
      tone={danger ? "danger" : "default"}
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      sheet={
      <Sheet
        open={open}
        onClose={() => {
          setOpen(false);
          setErrorKey(null);
        }}
        title={sheetTitle}
        description={intro}
      >
        <ul className="flex list-disc flex-col gap-2 pl-6 text-body">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {errorKey ? <Alert tone="error">{t(errorKey)}</Alert> : null}
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            variant={danger ? "destructive" : "primary"}
            wide
            loading={submitting}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            wide
            disabled={submitting}
            onClick={() => setOpen(false)}
          >
            {t("manageEmployee.offboardCancel")}
          </Button>
        </div>
      </Sheet>
      }
    />
  );
}

export interface OffboardRowProps {
  employeeName: string;
  /** From `offboardConfirmLines`: what happens, in plain Dutch. */
  lines: readonly CopyLine[];
  action: () => Promise<ActionResult>;
}

/** "Uit dienst": a red row; the sheet lists what happens first. */
export function OffboardRow({ employeeName, lines, action }: OffboardRowProps) {
  return (
    <ConfirmRow
      rowTitle={t("manageEmployee.offboardButton")}
      danger
      sheetTitle={t("manageEmployee.offboardConfirmTitle", { name: employeeName })}
      intro={t("manageEmployee.offboardConfirmIntro")}
      lines={lines.map((line) => t(line.key, line.values))}
      confirmLabel={t("manageEmployee.offboardConfirm")}
      action={action}
    />
  );
}

export interface ReinstateRowProps {
  employeeName: string;
  action: () => Promise<ActionResult>;
}

/** "Terug in dienst": the database refuses once anonymised. */
export function ReinstateRow({ employeeName, action }: ReinstateRowProps) {
  return (
    <ConfirmRow
      rowTitle={t("manageEmployee.reinstateButton")}
      danger={false}
      sheetTitle={t("manageEmployee.reinstateTitle", { name: employeeName })}
      lines={[
        t("manageEmployee.reinstateConsequenceLogin", { name: employeeName }),
        t("manageEmployee.reinstateNote"),
      ]}
      confirmLabel={t("manageEmployee.reinstateConfirm")}
      action={action}
    />
  );
}

export interface SignOutEverywhereRowProps {
  employeeId: string;
  employeeName: string;
  action: (formData: FormData) => Promise<void>;
}

/** Signs an employee out of every device; a sheet explains it first. */
export function SignOutEverywhereRow({
  employeeId,
  employeeName,
  action,
}: SignOutEverywhereRowProps) {
  return (
    <ConfirmRow
      rowTitle={t("manageTeam.signOutEverywhere")}
      danger
      sheetTitle={t("manageTeam.signOutTitle", { name: employeeName })}
      lines={[t("manageTeam.signOutBody", { name: employeeName })]}
      confirmLabel={t("manageTeam.signOutConfirmButton")}
      action={async () => {
        const formData = new FormData();
        formData.set("employeeId", employeeId);
        await action(formData);
        return { ok: true };
      }}
    />
  );
}
