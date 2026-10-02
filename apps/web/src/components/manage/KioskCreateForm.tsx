"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { PairingCodeResult } from "@/app/manage/(beveiligd)/meer/kiosks/actions";

import { Notice } from "../ui/Notice";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Heading } from "../ui/Heading";
import { Stack } from "../ui/Stack";
import { TextInput } from "../ui/TextInput";
import { PairingCodeCard } from "./PairingCodeCard";

export interface KioskCreateFormProps {
  sites: readonly { id: string; name: string }[];
  pairUrl: string;
  action: (input: { siteId: string; name: string }) => Promise<PairingCodeResult>;
}

interface Created {
  name: string;
  code: string;
  expiresAt: string;
}

/** A site and a name; the answer is the pairing code, shown once. */
export function KioskCreateForm({ sites, pairUrl, action }: KioskCreateFormProps) {
  const router = useRouter();
  const [siteId, setSiteId] = useState(sites[0]?.id ?? "");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    setCreated(null);
    const result = await action({ siteId, name });
    setSubmitting(false);
    if (!result.ok || !result.code || !result.expiresAt) {
      setErrorKey(result.errorKey ?? "manageKiosks.errorGeneric");
      return;
    }
    setCreated({ name: name.trim(), code: result.code, expiresAt: result.expiresAt });
    setName("");
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
    >
      <Heading level={2}>{t("manageKiosks.newHeading")}</Heading>
      {errorKey ? (
        <Notice tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey)}
        </Notice>
      ) : null}
      {created ? (
        <PairingCodeCard
          deviceName={created.name}
          code={created.code}
          expiresAt={created.expiresAt}
          pairUrl={pairUrl}
        />
      ) : null}
      <Stack gap="md">
        <Field id="kiosk-site" label={t("manageKiosks.siteLabel")}>
          <select
            value={siteId}
            onChange={(event) => setSiteId(event.target.value)}
            className="focus-ring min-h-touch-target rounded-md border-2 border-line bg-card px-4 text-lg text-ink"
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
        <div>
          <Button type="submit" size="md" loading={submitting}>
            {t("manageKiosks.create")}
          </Button>
        </div>
      </Stack>
    </form>
  );
}
