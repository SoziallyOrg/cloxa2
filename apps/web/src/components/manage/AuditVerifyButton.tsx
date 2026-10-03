"use client";

import { useState, useTransition } from "react";
import { CircleCheck, ShieldCheck, TriangleAlert } from "lucide-react";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { VerifyChainsActionResult } from "@/app/manage/(beveiligd)/meer/audit/actions";

import { Button } from "../ui/Button";

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
    <div className="flex max-w-readable flex-col gap-3">
      <div className="flex flex-col gap-3 rounded-card bg-card p-5 shadow-card">
        <div className="flex items-start gap-3">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 size-6 shrink-0 text-forest"
            strokeWidth={1.75}
          />
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-section">{t("audit.verifyHeading")}</h2>
            <p className="text-subhead text-ink-2">
              {isOwner ? t("audit.verifyIntro") : t("audit.verifyOwnerOnly")}
            </p>
          </div>
        </div>
        <div className="md:max-w-xs">
          <Button
            wide
            disabled={!isOwner}
            loading={pending}
            aria-busy={pending || undefined}
            onClick={run}
          >
            {pending ? t("audit.verifyChecking") : t("audit.verifyButton")}
          </Button>
        </div>
      </div>
      <div role="status" className="empty:hidden">
        {outcome?.kind === "success" ? (
          <div className="flex items-start gap-3 rounded-card bg-forest p-4 text-white">
            <CircleCheck
              aria-hidden="true"
              className="mt-0.5 size-6 shrink-0 text-lime"
              strokeWidth={1.75}
            />
            <div className="flex flex-col gap-0.5">
              <p className="text-body font-bold">{t("audit.verifyOkTitle")}</p>
              <p className="text-subhead text-on-forest-2">
                {t("audit.verifySuccess", { time: outcome.checkedAt })}
              </p>
            </div>
          </div>
        ) : null}
        {outcome?.kind === "failure" ? (
          <div className="flex items-start gap-3 rounded-card bg-danger-tint p-4 text-danger-tint-ink">
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-6 shrink-0"
              strokeWidth={1.75}
            />
            <div className="flex min-w-0 flex-col gap-1 text-body break-words">
              <p className="font-bold">{t("audit.verifyFailureHeading")}</p>
              {outcome.clockBrokenEventId ? (
                <p>
                  {t("audit.verifyFailureClock", { id: outcome.clockBrokenEventId })}
                </p>
              ) : null}
              {outcome.auditBrokenRowId ? (
                <p>{t("audit.verifyFailureAudit", { id: outcome.auditBrokenRowId })}</p>
              ) : null}
              <p>{t("audit.verifyFailureContact")}</p>
            </div>
          </div>
        ) : null}
        {outcome?.kind === "error" ? (
          <p className="rounded-card bg-danger-tint p-4 text-body font-semibold text-danger-tint-ink">
            {t(outcome.errorKey)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
