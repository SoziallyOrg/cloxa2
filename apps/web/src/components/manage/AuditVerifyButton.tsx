"use client";

import { useState, useTransition } from "react";
import { CircleCheck, ShieldCheck, TriangleAlert } from "lucide-react";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { VerifyChainsActionResult } from "@/app/manage/(beveiligd)/meer/audit/actions";

import { Row, Section } from "../ui/List";

export interface AuditVerifyButtonProps {
  /** Only an owner may run this; admins see the row disabled with an explanation. */
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

/**
 * "Controleer integriteit": runs `rpc_verify_chains` and says the result
 * plainly: a calm check when all is well, a clear red failure otherwise.
 */
export function AuditVerifyButton({ isOwner, action }: AuditVerifyButtonProps) {
  const [pending, startTransition] = useTransition();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  function run() {
    setOutcome(null);
    startTransition(async () => {
      const response = await action();
      if (!response.ok) {
        setOutcome({
          kind: "error",
          errorKey: response.errorKey ?? "audit.verifyError",
        });
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
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Section footer={isOwner ? t("audit.verifyIntro") : t("audit.verifyOwnerOnly")}>
        <Row
          icon={ShieldCheck}
          title={pending ? t("audit.verifyChecking") : t("audit.verifyButton")}
          disabled={!isOwner || pending}
          aria-busy={pending || undefined}
          onClick={run}
        />
      </Section>
      <div role="status" className="empty:hidden">
        {outcome?.kind === "success" ? (
          <div className="flex items-start gap-3 px-4">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-6 shrink-0 text-working"
              strokeWidth={1.75}
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-body font-semibold">{t("audit.verifyOkTitle")}</p>
              <p className="text-subhead text-ink-2">
                {t("audit.verifySuccess", { time: outcome.checkedAt })}
              </p>
            </div>
          </div>
        ) : null}
        {outcome?.kind === "failure" ? (
          <div className="flex items-start gap-3 rounded-list bg-surface px-4 py-3">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-6 shrink-0 text-danger"
              strokeWidth={1.75}
            />
            <div className="flex min-w-0 flex-col gap-1 text-body break-words">
              <p className="font-semibold text-danger">
                {t("audit.verifyFailureHeading")}
              </p>
              {outcome.clockBrokenEventId ? (
                <p>
                  {t("audit.verifyFailureClock", { id: outcome.clockBrokenEventId })}
                </p>
              ) : null}
              {outcome.auditBrokenRowId ? (
                <p>{t("audit.verifyFailureAudit", { id: outcome.auditBrokenRowId })}</p>
              ) : null}
              <p className="text-ink-2">{t("audit.verifyFailureContact")}</p>
            </div>
          </div>
        ) : null}
        {outcome?.kind === "error" ? (
          <p className="px-4 text-body font-medium text-danger">
            {t(outcome.errorKey)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
