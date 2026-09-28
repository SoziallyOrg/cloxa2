import { t } from "@cloxa/i18n";

export interface PairingCodeCardProps {
  deviceName: string;
  /** `ABCD-2345`. */
  code: string;
  /** Brussels wall time, e.g. `14:10`. */
  expiresAt: string;
  /** Absolute `/kiosk/koppelen` URL of this Cloxa. */
  pairUrl: string;
}

/** The one-time code, large enough to read from across the counter. */
export function PairingCodeCard({
  deviceName,
  code,
  expiresAt,
  pairUrl,
}: PairingCodeCardProps) {
  return (
    <div
      role="status"
      className="flex flex-col gap-3 rounded-lg border-2 border-primary bg-surface p-6"
    >
      <p className="text-lg font-semibold">
        {t("manageKiosks.codeHeading", { name: deviceName })}
      </p>
      <p
        data-testid="pairing-code"
        className="font-mono text-5xl font-bold tracking-widest break-all"
      >
        {code}
      </p>
      <p className="text-lg">{t("manageKiosks.codeInstruction", { url: pairUrl })}</p>
      <p className="text-base text-ink/70">
        {t("manageKiosks.codeExpires", { time: expiresAt })}
      </p>
    </div>
  );
}
