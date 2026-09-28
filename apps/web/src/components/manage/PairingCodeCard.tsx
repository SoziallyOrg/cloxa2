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

/** The one-time code, huge and monospaced: readable from across the counter. */
export function PairingCodeCard({
  deviceName,
  code,
  expiresAt,
  pairUrl,
}: PairingCodeCardProps) {
  return (
    <div role="status" className="flex flex-col items-center gap-4 py-2 text-center">
      <p className="text-body text-ink-2">
        {t("manageKiosks.codeHeading", { name: deviceName })}
      </p>
      <p
        data-testid="pairing-code"
        className="font-mono text-[44px] leading-tight font-medium tracking-[0.12em] break-all md:text-[56px]"
      >
        {code}
      </p>
      <p className="text-body break-words">
        {t("manageKiosks.codeInstruction", { url: pairUrl })}
      </p>
      <p className="text-subhead text-ink-2">
        {t("manageKiosks.codeExpires", { time: expiresAt })}
      </p>
    </div>
  );
}
