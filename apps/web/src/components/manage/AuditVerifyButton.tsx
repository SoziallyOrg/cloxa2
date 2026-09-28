"use client";

import { useState } from "react";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { VerifyChainsActionResult } from "@/app/manage/(beveiligd)/meer/audit/actions";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";

export interface AuditVerifyButtonProps {
  /** Only an owner may run this; admins see the button disabled with an explanation. */
  isOwner: boolean;
  action: () => Promise<VerifyChainsActionResult>;
}

type Outcome =
  | { kind: "success"; checkedAt: string }
  | {
      kind: "failure";
      clockBrokenEventId: string | null;
      auditBrokenRowId: string | null;
    }
  | { kind: "error"; errorKey: CatalogKey };

/** "Controleer integriteit": runs `rpc_verify_chains` and states the result plainly. */
export function AuditVerifyButton({ isOwner, action }: AuditVerifyButtonProps) {
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function run() {
    setPending(true);
    setOutcome(null);
    const response = await action();
    setPending(false);
    if (!response.ok) {
      setOutcome({ kind: "error", errorKey: response.errorKey ?? "audit.verifyError" });
      return;
    }
    if (response.result?.ok) {
      setOutcome({ kind: "success", checkedAt: response.checkedAt ?? "" });
      return;
    }
    if (response.result) {
      setOutcome({
        kind: "failure",
        clockBrokenEventId: response.result.clockBrokenEventId,
        auditBrokenRowId: response.result.auditBrokenRowId,
      });
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-ink/70">{t("audit.verifyIntro")}</p>
      <Button
        variant="secondary"
        size="md"
        loading={pending}
        disabled={!isOwner}
        onClick={() => void run()}
      >
        {t("audit.verifyButton")}
      </Button>
      {!isOwner ? <p className="text-ink/70">{t("audit.verifyOwnerOnly")}</p> : null}
      {outcome?.kind === "success" ? (
        <Alert tone="success">
          {t("audit.verifySuccess", { time: outcome.checkedAt })}
        </Alert>
      ) : null}
      {outcome?.kind === "failure" ? (
        <Alert tone="error">
          <span className="flex flex-col gap-1">
            <span className="font-semibold">{t("audit.verifyFailureHeading")}</span>
            {outcome.clockBrokenEventId ? (
              <span>
                {t("audit.verifyFailureClock", { id: outcome.clockBrokenEventId })}
              </span>
            ) : null}
            {outcome.auditBrokenRowId ? (
              <span>
                {t("audit.verifyFailureAudit", { id: outcome.auditBrokenRowId })}
              </span>
            ) : null}
            <span>{t("audit.verifyFailureContact")}</span>
          </span>
        </Alert>
      ) : null}
      {outcome?.kind === "error" ? (
        <Alert tone="error" onDismiss={() => setOutcome(null)}>
          {t(outcome.errorKey)}
        </Alert>
      ) : null}
    </div>
  );
}
