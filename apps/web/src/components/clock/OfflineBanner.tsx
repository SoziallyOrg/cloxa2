import { t } from "@cloxa/i18n";

/** Shown whenever the client detects it has no connection. */
export function OfflineBanner() {
  return (
    <p
      role="status"
      className="rounded-md bg-status-off-bg px-4 py-3 text-center font-semibold text-status-off"
    >
      {t("offline.banner")}
    </p>
  );
}
