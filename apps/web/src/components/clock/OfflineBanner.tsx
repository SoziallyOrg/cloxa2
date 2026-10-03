import { t } from "@cloxa/i18n";

import { cx } from "../ui/cx";

export interface OfflineBannerProps {
  /** Clock actions are kept on the device and sent later (ADR 006). */
  queueing: boolean;
}

/**
 * Shown whenever the client detects it has no connection. Calm when clocking
 * still works (kept on the device); orange when it doesn't.
 */
export function OfflineBanner({ queueing }: OfflineBannerProps) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-control bg-card px-4 py-3.5 shadow-card"
    >
      <span
        aria-hidden="true"
        className={cx(
          "mt-1.5 size-3 shrink-0 rounded-full ring-[3px]",
          queueing ? "bg-ink-3 ring-ink-3/20" : "bg-attention ring-attention/20",
        )}
      />
      <p className="text-subhead text-ink">
        {t(queueing ? "offline.banner" : "offline.bannerUnsupported")}
      </p>
    </div>
  );
}
