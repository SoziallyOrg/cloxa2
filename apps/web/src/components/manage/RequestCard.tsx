import { t } from "@cloxa/i18n";

import type { RequestModel } from "@/lib/manage/requests";

import { cx } from "../ui/cx";
import { StatusLine } from "../ui/StatusLine";
import { SubmitButton } from "../ui/SubmitButton";
import { RejectRequest } from "./RejectRequest";

export interface RequestCardProps {
  readonly request: RequestModel;
  /** `soft`: grey card for the white side panel. `plain`: white card on the paper page. */
  readonly surface?: "soft" | "plain";
  readonly approveAction?: (formData: FormData) => Promise<void>;
  readonly rejectAction?: (formData: FormData) => Promise<void>;
}

/**
 * One correction request in identity D: who and which day, the employee's
 * own words, then two tiles, "Was" on white and "Wordt" on forest, and the
 * decisions: Goedkeuren is one tap, Weigeren asks for a note first. The
 * caller wraps it (`li` on a page, a plain div in the panel).
 */
export function RequestCard({
  request,
  surface = "plain",
  approveAction,
  rejectAction,
}: RequestCardProps) {
  const { id, employeeName, decision } = request;
  return (
    <div
      className={cx(
        "flex flex-col gap-3 rounded-card p-4",
        surface === "soft" ? "bg-paper" : "bg-card shadow-card",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 className="text-headline break-words">{employeeName}</h3>
          <p className="text-subhead text-ink-2">
            {request.dayLabel} · {request.kindLabel}
          </p>
        </div>
        {decision ? (
          <StatusLine size="sm" tone={decision.tone} label={decision.statusLabel} />
        ) : request.offline ? (
          <span className="shrink-0 rounded-control border border-line px-2 text-caption leading-6 text-ink-2">
            {t("offline.shiftBadge")}
          </span>
        ) : null}
      </div>

      {request.reason ? (
        <p className="text-subhead break-words text-ink-2">
          <span className="sr-only">{t("manageVragen.reasonLabel")}: </span>
          {t("manageVragen.reasonQuote", { reason: request.reason })}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2">
        <div className="flex min-w-0 flex-col rounded-control border border-line bg-card px-3 py-2">
          <span className="text-caption-2 text-ink-2">
            {t("manageVragen.wasLabel")}
          </span>
          <span className="text-title-3 break-words tabular-nums">
            {request.was ?? t("manageVragen.noneValue")}
          </span>
        </div>
        <div className="flex min-w-0 flex-col rounded-control bg-forest px-3 py-2 text-white">
          <span className="text-caption-2 text-on-forest-2">
            {t("manageVragen.wordtLabel")}
          </span>
          <span className="text-title-3 break-words tabular-nums">
            {request.wordt ?? t("manageVragen.removedValue")}
          </span>
        </div>
      </div>

      {request.resultingShiftLabel ? (
        <p className="text-subhead text-ink-2">
          {t("manageVragen.resultingShiftLabel", {
            value: request.resultingShiftLabel,
          })}
        </p>
      ) : null}

      {decision?.note ? (
        <p className="text-subhead break-words text-ink-2">
          {t("manageVragen.decidedNote", { note: decision.note })}
        </p>
      ) : null}

      {approveAction && rejectAction ? (
        <div className="grid grid-cols-2 gap-2">
          <form action={approveAction} className="contents">
            <input type="hidden" name="id" value={id} />
            <SubmitButton wide size={surface === "soft" ? "sm" : "md"}>
              {t("manageVragen.approve")}
            </SubmitButton>
          </form>
          <RejectRequest
            id={id}
            employeeName={employeeName}
            action={rejectAction}
            size={surface === "soft" ? "sm" : "md"}
          />
        </div>
      ) : null}
    </div>
  );
}
