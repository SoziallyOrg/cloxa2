"use client";

import { useState } from "react";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { PairingCodeResult } from "@/app/manage/(beveiligd)/meer/kiosks/actions";

import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { PairingCodeCard } from "./PairingCodeCard";

export interface KioskDeviceActionsProps {
  deviceId: string;
  deviceName: string;
  pairUrl: string;
  newCodeAction: (deviceId: string) => Promise<PairingCodeResult>;
  revokeAction: (formData: FormData) => Promise<void>;
}

/** A new pairing code (e.g. for a replacement tablet), or revoking the kiosk. */
export function KioskDeviceActions({
  deviceId,
  deviceName,
  pairUrl,
  newCodeAction,
  revokeAction,
}: KioskDeviceActionsProps) {
  const [pending, setPending] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);

  async function newCode() {
    setPending(true);
    setErrorKey(null);
    const result = await newCodeAction(deviceId);
    setPending(false);
    if (!result.ok || !result.code || !result.expiresAt) {
      setErrorKey(result.errorKey ?? "manageKiosks.errorGeneric");
      return;
    }
    setCode({ code: result.code, expiresAt: result.expiresAt });
  }

  return (
    <div className="flex flex-col gap-3">
      {errorKey ? (
        <Notice tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey)}
        </Notice>
      ) : null}
      {code ? (
        <PairingCodeCard
          deviceName={deviceName}
          code={code.code}
          expiresAt={code.expiresAt}
          pairUrl={pairUrl}
        />
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          size="md"
          loading={pending}
          onClick={() => void newCode()}
        >
          {t("manageKiosks.newCode")}
        </Button>
        <form
          action={revokeAction}
          onSubmit={(event) => {
            if (
              !window.confirm(t("manageKiosks.revokeConfirm", { name: deviceName }))
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="deviceId" value={deviceId} />
          <Button type="submit" variant="destructive" size="md">
            {t("manageKiosks.revoke")}
          </Button>
        </form>
      </div>
    </div>
  );
}
