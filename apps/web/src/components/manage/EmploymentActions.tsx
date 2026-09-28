"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { CopyLine } from "@/lib/manage/offboarding";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Heading } from "../ui/Heading";

type ActionResult = { readonly ok: boolean; readonly errorKey?: CatalogKey };

export interface OffboardFormProps {
  employeeName: string;
  /** From `offboardConfirmLines`: what happens, in plain Dutch. */
  lines: readonly CopyLine[];
  action: () => Promise<ActionResult>;
}

/**
 * "Uit dienst" in two steps: the first button only shows what will happen;
 * nothing changes until "Ja, zet uit dienst".
 */
export function OffboardForm({ employeeName, lines, action }: OffboardFormProps) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const opened = useRef(false);

  // Move focus with the step, so keyboard and screen-reader users follow it.
  useEffect(() => {
    if (confirming) {
      opened.current = true;
      panelRef.current?.focus();
    } else if (opened.current) {
      startRef.current?.querySelector("button")?.focus();
    }
  }, [confirming]);

  async function confirm() {
    setSubmitting(true);
    setErrorKey(null);
    const result = await action();
    setSubmitting(false);
    if (!result.ok) {
      setErrorKey(result.errorKey ?? "manageEmployee.errorGeneric");
      return;
    }
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {errorKey ? (
        <Alert tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey)}
        </Alert>
      ) : null}
      {confirming ? (
        <section
          ref={panelRef}
          tabIndex={-1}
          aria-label={t("manageEmployee.offboardConfirmTitle", { name: employeeName })}
          className="focus-ring flex flex-col gap-4 rounded-lg border-2 border-danger p-4"
        >
          <Heading level={3}>
            {t("manageEmployee.offboardConfirmTitle", { name: employeeName })}
          </Heading>
          <p className="text-lg">{t("manageEmployee.offboardConfirmIntro")}</p>
          <ul className="flex list-disc flex-col gap-2 pl-6 text-lg">
            {lines.map((line) => (
              <li key={line.key}>{t(line.key, line.values)}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              variant="destructive"
              size="md"
              loading={submitting}
              onClick={() => void confirm()}
            >
              {t("manageEmployee.offboardConfirm")}
            </Button>
            <Button
              type="button"
              variant="plain"
              size="md"
              disabled={submitting}
              onClick={() => setConfirming(false)}
            >
              {t("manageEmployee.offboardCancel")}
            </Button>
          </div>
        </section>
      ) : (
        <div ref={startRef}>
          <Button
            type="button"
            variant="destructive"
            size="md"
            onClick={() => setConfirming(true)}
          >
            {t("manageEmployee.offboardButton")}
          </Button>
        </div>
      )}
    </div>
  );
}

export interface ReinstateFormProps {
  action: () => Promise<ActionResult>;
}

/** "Terug in dienst": one button, the database refuses once anonymised. */
export function ReinstateForm({ action }: ReinstateFormProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);

  async function reinstate() {
    setSubmitting(true);
    setErrorKey(null);
    const result = await action();
    setSubmitting(false);
    if (!result.ok) {
      setErrorKey(result.errorKey ?? "manageEmployee.errorGeneric");
      return;
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      {errorKey ? (
        <Alert tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey)}
        </Alert>
      ) : null}
      <div>
        <Button
          type="button"
          variant="secondary"
          size="md"
          loading={submitting}
          onClick={() => void reinstate()}
        >
          {t("manageEmployee.reinstateButton")}
        </Button>
      </div>
    </div>
  );
}
