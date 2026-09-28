import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Stack } from "../ui/Stack";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";
import { TextInput } from "../ui/TextInput";

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
  readonly dateLabel: string;
  readonly kindLabel: string;
  readonly changes: readonly RequestCardChange[];
  readonly resultingShiftLabel: string | null;
  readonly reason: string;
  /** Present for the "Behandeld" tab; absent (pending) shows the decide buttons. */
  readonly decision?: RequestCardDecision;
  readonly approveAction?: (formData: FormData) => Promise<void>;
  readonly rejectAction?: (formData: FormData) => Promise<void>;
}

/** One correction request: employee, date, a "voor -> na" diff and its reason. */
export function RequestCard({
  id,
  employeeName,
  dateLabel,
  kindLabel,
  changes,
  resultingShiftLabel,
  reason,
  decision,
  approveAction,
  rejectAction,
}: RequestCardProps) {
  return (
    <li className="flex flex-col gap-4 rounded-lg border border-border p-4">
      <Stack row gap="sm" className="flex-wrap justify-between">
        <div className="flex flex-col">
          <span className="text-lg font-semibold">{employeeName}</span>
          <span className="text-ink/70">{dateLabel}</span>
        </div>
        {decision ? (
          <StatusBadge tone={decision.tone} label={decision.statusLabel} />
        ) : null}
      </Stack>

      <p className="font-semibold">{kindLabel}</p>

      <ul className="flex flex-col gap-1">
        {changes.map((change, index) => (
          <li key={index} className="text-ink/70">
            {change.typeLabel}:{" "}
            {change.beforeLabel ? (
              <span>
                {t("manageVragen.beforeLabel")} {change.beforeLabel}{" "}
                {t("manageVragen.arrow")}{" "}
              </span>
            ) : null}
            <span className="font-semibold text-ink">
              {t("manageVragen.afterLabel")} {change.afterLabel ?? "—"}
            </span>
          </li>
        ))}
      </ul>

      {resultingShiftLabel ? (
        <p className="text-ink/70">
          {t("manageVragen.resultingShiftLabel", { value: resultingShiftLabel })}
        </p>
      ) : null}

      <div>
        <p className="text-base font-semibold">{t("manageVragen.reasonLabel")}</p>
        <p className="text-ink/70">{reason}</p>
      </div>

      {decision?.note ? (
        <p className="text-ink/70">
          {t("manageVragen.decidedNote", { note: decision.note })}
        </p>
      ) : null}

      {approveAction && rejectAction ? (
        <Stack row gap="md" className="flex-wrap">
          <form action={approveAction}>
            <input type="hidden" name="id" value={id} />
            <Button type="submit" variant="primary" size="md">
              {t("manageVragen.approve")}
            </Button>
          </form>
          <form action={rejectAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={id} />
            <Field id={`reject-note-${id}`} label={t("manageVragen.rejectNoteLabel")}>
              <TextInput
                id={`reject-note-${id}`}
                name="note"
                required
                maxLength={280}
              />
            </Field>
            <Button type="submit" variant="danger" size="md">
              {t("manageVragen.reject")}
            </Button>
          </form>
        </Stack>
      ) : null}
    </li>
  );
}
