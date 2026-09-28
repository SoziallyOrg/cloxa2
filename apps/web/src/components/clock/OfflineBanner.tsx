import { t } from "@cloxa/i18n";

export interface OfflineBannerProps {
  /** Clock actions are kept on the device and sent later (ADR 006). */
  queueing: boolean;
}

/** Shown whenever the client detects it has no connection. */
export function OfflineBanner({ queueing }: OfflineBannerProps) {
  return (
    <p
      role="status"
      className="rounded-md bg-status-off-bg px-4 py-3 text-center font-semibold text-status-off"
    >
      {t(queueing ? "offline.banner" : "offline.bannerUnsupported")}
    </p>
  );
}
