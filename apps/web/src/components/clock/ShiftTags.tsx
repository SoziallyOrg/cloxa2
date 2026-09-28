import { t } from "@cloxa/i18n";

export interface ShiftTagsProps {
  range: string;
  edited: boolean;
  offline: boolean;
  /** One more quiet note, e.g. "verstuurd 2 u later". */
  extra?: string | null;
}

const TAG = "rounded-full bg-paper px-2 text-callout leading-6 text-ink-2";

/** "08:02–16:31" followed by small "aangepast" / "offline" text tags. */
export function ShiftTags({ range, edited, offline, extra = null }: ShiftTagsProps) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{range}</span>
      {edited ? <span className={TAG}>{t("shifts.edited")}</span> : null}
      {offline ? <span className={TAG}>{t("offline.shiftBadge")}</span> : null}
      {extra ? <span>{extra}</span> : null}
    </span>
  );
}
