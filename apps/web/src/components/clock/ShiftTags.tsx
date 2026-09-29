import { t } from "@cloxa/i18n";

export interface ShiftTagsProps {
  range: string;
  edited: boolean;
  offline: boolean;
  /** Worked at home (telework module): a small "thuis" tag. */
  home?: boolean;
  /** One more quiet note, e.g. "verstuurd 2 u later". */
  extra?: string | null;
}

// An outline, not a fill: secondary text keeps AA on rows and sheets alike.
const TAG =
  "rounded-full border-[0.5px] border-separator px-2 text-subhead leading-6 text-ink-2";

/** "08:02–16:31" followed by small "aangepast" / "offline" / "thuis" text tags. */
export function ShiftTags({
  range,
  edited,
  offline,
  home = false,
  extra = null,
}: ShiftTagsProps) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span>{range}</span>
      {edited ? <span className={TAG}>{t("shifts.edited")}</span> : null}
      {offline ? <span className={TAG}>{t("offline.shiftBadge")}</span> : null}
      {home ? <span className={TAG}>{t("modules.telework.shiftHome")}</span> : null}
      {extra ? <span>{extra}</span> : null}
    </span>
  );
}
