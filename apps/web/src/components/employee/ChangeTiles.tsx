import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";

export interface ChangeTilesProps {
  /** What the change is about: "Gestopt met werken". */
  label?: string;
  was: string;
  willBe: string;
}

/**
 * "Was" on white and "Wordt" on forest (docs/design.md): the same change the
 * manager decides on, so both sides read it alike. The words say it, not
 * only the colours.
 */
export function ChangeTiles({ label, was, willBe }: ChangeTilesProps) {
  return (
    <div className="flex flex-col gap-1.5">
      {label ? <p className="text-subhead text-ink-2">{label}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="min-w-0 rounded-control border border-line bg-card px-3 py-2">
          <p className="text-caption-2 font-semibold text-ink-2">
            {t("questions.was")}
          </p>
          <p className="text-title-3 break-words tabular-nums">{was}</p>
        </div>
        <div className="on-forest min-w-0 rounded-control bg-forest px-3 py-2 text-white">
          <p className="text-caption-2 font-semibold text-on-forest-2">
            {t("questions.willBe")}
          </p>
          <p className={cx("text-title-3 break-words tabular-nums")}>{willBe}</p>
        </div>
      </div>
    </div>
  );
}
