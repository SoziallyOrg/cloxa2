"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, MonitorSmartphone, UserCheck, UserX } from "lucide-react";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { PinActionResult } from "@/lib/kiosk/pin";
import type { CopyLine } from "@/lib/manage/offboarding";

import { PinForm } from "../kiosk/PinForm";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Row, Section } from "../ui/List";
import { Notice } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";

type ActionResult = { readonly ok: boolean; readonly errorKey?: CatalogKey };

export interface PinSectionProps {
  employeeName: string;
  /** "Ingesteld" or "Nog niet ingesteld". */
  stateLabel: string;
  /** "Pincode ingesteld op 3 september 2026." or "Nog geen pincode.". */
  footer: string;
  action: (input: { pin: string; confirmation: string }) => Promise<PinActionResult>;
}

/** The kiosk PIN for staff without a login: a row, the form in a sheet. */
export function PinSection({
  employeeName,
  stateLabel,
  footer,
  action,
}: PinSectionProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Section footer={footer}>
        <Row
          icon={KeyRound}
          title={t("manageEmployee.pinRow")}
          value={stateLabel}
          chevron
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        />
      </Section>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manageEmployee.pinRow")}
        description={employeeName}
        closeLabel={t("ui.done")}
      >
        <PinForm
          id="employee-pin"
          variant="list"
          submitLabel={t("kiosk.managerPinSubmit")}
          savedMessage={t("kiosk.managerPinSaved")}
          action={action}
        />
      </Sheet>
    </>
  );
}

export interface SignOutSectionProps {
  employeeId: string;
  employeeName: string;
  action: (formData: FormData) => Promise<void>;
}

/** "Overal afmelden", for a lost phone: confirmed in an alert first. */
export function SignOutSection({
  employeeId,
  employeeName,
  action,
}: SignOutSectionProps) {
  const [asking, setAsking] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function signOut() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("employeeId", employeeId);
      await action(formData);
      setDone(true);
    });
  }

  return (
    <>
      {done ? (
        <Notice tone="success" onDismiss={() => setDone(false)}>
          {t("manageEmployee.signOutDone", { name: employeeName })}
        </Notice>
      ) : null}
      <Section
        header={t("manageEmployee.accessHeading")}
        footer={t("manageTeam.signOutHint")}
      >
        <Row
          icon={MonitorSmartphone}
          title={t("manageTeam.signOutEverywhere")}
          aria-haspopup="dialog"
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={() => setAsking(true)}
        />
      </Section>
      <Alert
        open={asking}
        onClose={() => setAsking(false)}
        title={t("manageTeam.signOutTitle", { name: employeeName })}
        message={t("manageTeam.signOutBody", { name: employeeName })}
        confirmLabel={t("manageTeam.signOutConfirmButton")}
        destructive
        onConfirm={signOut}
      />
    </>
  );
}

export interface OffboardSectionProps {
  employeeName: string;
  /** "{name} is in dienst." */
  footer: string;
  /** From `offboardConfirmLines`: what happens, in plain Dutch. */
  lines: readonly CopyLine[];
  /** `false` for the owner and oneself: the row is left out. */
  canOffboard: boolean;
  action: () => Promise<ActionResult>;
}

/**
 * "Uit dienst", at the bottom of the page. The row only opens a sheet that
 * explains what will happen; nothing changes until "Ja, zet uit dienst".
 */
export function OffboardSection({
  employeeName,
  footer,
  lines,
  canOffboard,
  action,
}: OffboardSectionProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);

  function confirm() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setErrorKey(result.errorKey ?? "manageEmployee.errorGeneric");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  if (!canOffboard) {
    return <p className="px-4 text-subhead text-ink-2">{footer}</p>;
  }

  return (
    <>
      <Section footer={footer}>
        <Row
          icon={UserX}
          tone="danger"
          title={t("manageEmployee.offboardButton")}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        />
      </Section>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manageEmployee.offboardConfirmTitle", { name: employeeName })}
        closeLabel={t("ui.cancel")}
      >
        <div className="flex flex-col gap-3">
          <p className="text-body text-ink-2">
            {t("manageEmployee.offboardConfirmIntro")}
          </p>
          <ul className="flex list-disc flex-col gap-2 pl-5 text-body">
            {lines.map((line) => (
              <li key={line.key}>{t(line.key, line.values)}</li>
            ))}
          </ul>
        </div>
        {errorKey ? <Notice tone="error">{t(errorKey)}</Notice> : null}
        <Button variant="danger" wide loading={pending} onClick={confirm}>
          {t("manageEmployee.offboardConfirm")}
        </Button>
      </Sheet>
    </>
  );
}

export interface ReinstateSectionProps {
  employeeName: string;
  /** "Uit dienst sinds …", then the PIN note. */
  footer: React.ReactNode;
  action: () => Promise<ActionResult>;
}

/** "Terug in dienst": an alert says what it does; the database refuses once anonymised. */
export function ReinstateSection({
  employeeName,
  footer,
  action,
}: ReinstateSectionProps) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);

  function reinstate() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setErrorKey(result.errorKey ?? "manageEmployee.errorGeneric");
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      {errorKey ? (
        <Notice tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey)}
        </Notice>
      ) : null}
      <Section footer={footer}>
        <Row
          icon={UserCheck}
          title={t("manageEmployee.reinstateButton")}
          aria-haspopup="dialog"
          aria-busy={pending || undefined}
          disabled={pending}
          onClick={() => setAsking(true)}
        />
      </Section>
      <Alert
        open={asking}
        onClose={() => setAsking(false)}
        title={t("manageEmployee.reinstateTitle", { name: employeeName })}
        message={t("manageEmployee.reinstateBody", { name: employeeName })}
        confirmLabel={t("manageEmployee.reinstateConfirm")}
        onConfirm={reinstate}
      />
    </>
  );
}
