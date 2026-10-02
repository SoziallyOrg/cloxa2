"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { PairingCodeResult } from "@/app/manage/(beveiligd)/meer/kiosks/actions";

import { ActionSheet } from "../ui/ActionSheet";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Badge, Td, Tr } from "../ui/DataTable";
import { Field } from "../ui/Field";
import { Row } from "../ui/List";
import { NavBarButton } from "../ui/NavBar";
import { Notice } from "../ui/Notice";
import { Sheet } from "../ui/Sheet";
import { inputClassName, TextInput } from "../ui/TextInput";
import { PairingCodeCard } from "./PairingCodeCard";

interface ShownCode {
  name: string;
  code: string;
  expiresAt: string;
}

export interface NewKioskProps {
  sites: readonly { id: string; name: string }[];
  pairUrl: string;
  action: (input: { siteId: string; name: string }) => Promise<PairingCodeResult>;
}

/**
 * "Nieuwe kiosk" in the navigation bar. The sheet asks for a site and a
 * name; its answer is the pairing code, shown once, in the same sheet.
 */
export function NewKiosk({ sites, pairUrl, action }: NewKioskProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [created, setCreated] = useState<ShownCode | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setErrorKey(null);
    startTransition(async () => {
      const result = await action({ siteId, name });
      if (!result.ok || !result.code || !result.expiresAt) {
        setErrorKey(result.errorKey ?? "manageKiosks.errorGeneric");
        return;
      }
      setCreated({ name: name.trim(), code: result.code, expiresAt: result.expiresAt });
      setName("");
      router.refresh();
    });
  }

  return (
    <>
      <NavBarButton
        strong
        aria-haspopup="dialog"
        onClick={() => {
          setCreated(null);
          setErrorKey(null);
          setOpen(true);
        }}
      >
        {t("manageKiosks.newAction")}
      </NavBarButton>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manageKiosks.newSheetTitle")}
        closeLabel={created ? t("ui.done") : t("ui.cancel")}
      >
        {created ? (
          <PairingCodeCard
            deviceName={created.name}
            code={created.code}
            expiresAt={created.expiresAt}
            pairUrl={pairUrl}
          />
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-6">
            {errorKey ? <Notice tone="error">{t(errorKey)}</Notice> : null}
            <Field id="kiosk-site" label={t("manageKiosks.siteLabel")}>
              <select
                value={siteId}
                onChange={(event) => setSiteId(event.target.value)}
                className={inputClassName}
              >
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="kiosk-name"
              label={t("manageKiosks.nameLabel")}
              hint={t("manageKiosks.nameHint")}
            >
              <TextInput
                value={name}
                maxLength={100}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="submit" wide loading={pending}>
              {t("manageKiosks.createSubmit")}
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}

export interface KioskRowProps {
  deviceId: string;
  deviceName: string;
  /** "Laatst gezien: …" or "Nog niet gekoppeld". */
  subtitle: string;
  statusLabel: string;
  /** Revoked kiosks are a plain row: nothing left to do. */
  active: boolean;
  pairUrl: string;
  newCodeAction: (deviceId: string) => Promise<PairingCodeResult>;
  revokeAction: (formData: FormData) => Promise<void>;
}

/**
 * The choices for one tablet, shared by the phone row and the desktop table
 * row: a new pairing code (for a replacement tablet) or revoking it, which
 * asks once more in an alert.
 */
function useKioskDevice({
  deviceId,
  deviceName,
  pairUrl,
  newCodeAction,
  revokeAction,
}: KioskRowProps) {
  const [choosing, setChoosing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [code, setCode] = useState<ShownCode | null>(null);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [pending, startTransition] = useTransition();

  function newCode() {
    setErrorKey(null);
    startTransition(async () => {
      const result = await newCodeAction(deviceId);
      if (!result.ok || !result.code || !result.expiresAt) {
        setErrorKey(result.errorKey ?? "manageKiosks.errorGeneric");
        return;
      }
      setCode({ name: deviceName, code: result.code, expiresAt: result.expiresAt });
    });
  }

  function revoke() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("deviceId", deviceId);
      await revokeAction(formData);
    });
  }

  const dialogs = (
    <>
      <ActionSheet
        open={choosing}
        onClose={() => setChoosing(false)}
        title={deviceName}
        actions={[
          { key: "code", label: t("manageKiosks.newCode"), onSelect: newCode },
          {
            key: "revoke",
            label: t("manageKiosks.revoke"),
            destructive: true,
            onSelect: () => setConfirming(true),
          },
        ]}
      />
      <Alert
        open={confirming}
        onClose={() => setConfirming(false)}
        title={t("manageKiosks.revokeTitle", { name: deviceName })}
        message={t("manageKiosks.revokeBody")}
        confirmLabel={t("manageKiosks.revokeConfirmButton")}
        destructive
        onConfirm={revoke}
      />
      <Sheet
        open={code !== null}
        onClose={() => setCode(null)}
        title={t("manageKiosks.newCode")}
        closeLabel={t("ui.done")}
      >
        {code ? (
          <PairingCodeCard
            deviceName={code.name}
            code={code.code}
            expiresAt={code.expiresAt}
            pairUrl={pairUrl}
          />
        ) : null}
      </Sheet>
    </>
  );

  return { setChoosing, pending, errorKey, dialogs };
}

/** One tablet on a phone: a row. Tapping it offers the choices. */
export function KioskRow(props: KioskRowProps) {
  const { deviceName, subtitle, statusLabel, active } = props;
  const { setChoosing, pending, errorKey, dialogs } = useKioskDevice(props);

  if (!active) {
    return <Row title={deviceName} subtitle={subtitle} value={statusLabel} />;
  }

  return (
    <>
      <Row
        title={deviceName}
        subtitle={errorKey ? t(errorKey) : subtitle}
        value={statusLabel}
        chevron
        aria-haspopup="dialog"
        aria-busy={pending || undefined}
        disabled={pending}
        onClick={() => setChoosing(true)}
      />
      {/* The dialogs sit in a presentational item: a <ul> only holds <li>s. */}
      <li role="presentation" className="contents">
        {dialogs}
      </li>
    </>
  );
}

/** One tablet on desktop: a table row, with "Beheren" for the same choices. */
export function KioskTableRow(props: KioskRowProps & { siteName: string }) {
  const { deviceName, subtitle, statusLabel, active, siteName } = props;
  const { setChoosing, pending, errorKey, dialogs } = useKioskDevice(props);

  return (
    <Tr>
      <Td className="font-bold">{deviceName}</Td>
      <Td>{siteName}</Td>
      <Td>
        <Badge tone={active ? "forest" : "neutral"}>{statusLabel}</Badge>
      </Td>
      <Td className="text-ink-2">{errorKey ? t(errorKey) : subtitle}</Td>
      <Td align="right">
        {active ? (
          <>
            <Button
              variant="secondary"
              size="sm"
              aria-haspopup="dialog"
              loading={pending}
              onClick={() => setChoosing(true)}
            >
              {t("manageKiosks.manage")}
            </Button>
            {dialogs}
          </>
        ) : null}
      </Td>
    </Tr>
  );
}
