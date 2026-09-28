import { t } from "@cloxa/i18n";

import type { TimelineRowModel } from "@/lib/manage/timeline";

import { StatusLine, type StatusTone } from "../ui/StatusLine";
import { SubmitButton } from "../ui/SubmitButton";
import { RejectRequest } from "./RejectRequest";
import { TimelineAxis, TimelineTrack } from "./Timeline";

export interface RequestCardChange {
  readonly typeLabel: string;
  readonly beforeLabel: string | null;
  readonly afterLabel: string | null;
}

export interface RequestCardDecision {
  readonly tone: StatusTone;
  readonly statusLabel: string;
  readonly note: string | null;
}

export interface RequestCardProps {
  readonly id: string;
  readonly employeeName: string;
  /** "Maandag 28 september". */
  readonly dayLabel: string;
  /** What was asked, in plain Dutch: "Vergeten in te klokken". */
  readonly kindLabel: string;
  /** Queued offline and too late to fit: shown as a small tag. */
  readonly offline: boolean;
  readonly changes: readonly RequestCardChange[];
  readonly resultingShiftLabel: string | null;
  /** The day as it is now, and as it would be once approved. */
  readonly before: TimelineRowModel;
  readonly after: TimelineRowModel;
  /** Null once the requester was anonymised (ADR 007). */
  readonly reason: string | null;
  /** Present for "Behandeld"; absent (open) shows the decide buttons. */
  readonly decision?: RequestCardDecision;
  readonly approveAction?: (formData: FormData) => Promise<void>;
  readonly rejectAction?: (formData: FormData) => Promise<void>;
}

// An outline, not a fill, like the employee's shift tags.
const TAG =
  "shrink-0 rounded-full border-[0.5px] border-separator px-2 text-subhead leading-6 text-ink-2";
const PART = "ml-4 border-t-[0.5px] border-separator py-3 pr-4";

/**
 * One correction request as a soft group: who and which day, what was asked,
 * the day before and after on a small timeline, the reason, and the two
 * decisions. Approving is one tap; rejecting asks for a note in a sheet.
 */
export function RequestCard({
  id,
  employeeName,
  dayLabel,
  kindLabel,
  offline,
  changes,
  resultingShiftLabel,
  before,
  after,
  reason,
  decision,
  approveAction,
  rejectAction,
}: RequestCardProps) {
  return (
    <li className="overflow-hidden rounded-list bg-surface">
      <div className="flex items-start gap-3 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="truncate text-headline">{employeeName}</h2>
          <p className="text-subhead text-ink-2">{dayLabel}</p>
        </div>
        {decision ? (
          <StatusLine size="sm" tone={decision.tone} label={decision.statusLabel} />
        ) : offline ? (
          <span className={TAG}>{t("offline.shiftBadge")}</span>
        ) : null}
      </div>

      <div className={PART}>
        <p className="text-body font-medium">{kindLabel}</p>
        {changes.map((change, index) => (
          <p key={index} className="text-subhead text-ink-2">
            {change.typeLabel}:{" "}
            {change.beforeLabel ? (
              <span className="tabular-nums">
                {change.beforeLabel} {t("manageVragen.arrow")}{" "}
              </span>
            ) : null}
            <span className="font-medium text-ink tabular-nums">
              {change.afterLabel ?? t("manageVragen.removedValue")}
            </span>
          </p>
        ))}
        {resultingShiftLabel ? (
          <p className="text-subhead text-ink-2">
            {t("manageVragen.resultingShiftLabel", { value: resultingShiftLabel })}
          </p>
        ) : null}
      </div>

      <div className={PART}>
        <div
          role="img"
          aria-label={t("manageVragen.timelineLabel")}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2"
        >
          <span />
          <TimelineAxis />
          <span className="text-footnote text-ink-2">
            {t("manageVragen.beforeLabel")}
          </span>
          <TimelineTrack {...before} size="sm" />
          <span className="text-footnote font-semibold text-ink">
            {t("manageVragen.afterLabel")}
          </span>
          <TimelineTrack {...after} size="sm" />
        </div>
      </div>

      {reason ? (
        <div className={PART}>
          <p className="text-subhead text-ink-2">{t("manageVragen.reasonLabel")}</p>
          <p className="text-body break-words">{reason}</p>
        </div>
      ) : null}

      {decision?.note ? (
        <div className={PART}>
          <p className="text-subhead break-words text-ink-2">
            {t("manageVragen.decidedNote", { note: decision.note })}
          </p>
        </div>
      ) : null}

      {approveAction && rejectAction ? (
        <div className="grid grid-cols-2 gap-3 border-t-[0.5px] border-separator p-3">
          <form action={approveAction} className="contents">
            <input type="hidden" name="id" value={id} />
            <SubmitButton wide>{t("manageVragen.approve")}</SubmitButton>
          </form>
          <RejectRequest id={id} employeeName={employeeName} action={rejectAction} />
        </div>
      ) : null}
    </li>
  );
}
