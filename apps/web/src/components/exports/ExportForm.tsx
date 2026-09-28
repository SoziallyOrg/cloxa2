"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { t, type CatalogKey } from "@cloxa/i18n";

import type { ExportFormInput } from "@/lib/exports/form";

import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Field } from "../ui/Field";
import { Heading } from "../ui/Heading";
import { Stack } from "../ui/Stack";
import { TextInput } from "../ui/TextInput";

interface Period {
  readonly from: string;
  readonly to: string;
}

export interface ExportFormProps {
  sites: readonly { id: string; name: string }[];
  quickPicks: { previousMonth: Period; thisMonth: Period };
  action: (input: ExportFormInput) => Promise<{ ok: boolean; errorKey?: CatalogKey }>;
}

/** Period (with two quick picks) and sites; every visible site is ticked by default. */
export function ExportForm({ sites, quickPicks, action }: ExportFormProps) {
  const router = useRouter();
  const [from, setFrom] = useState(quickPicks.previousMonth.from);
  const [to, setTo] = useState(quickPicks.previousMonth.to);
  const [siteIds, setSiteIds] = useState<string[]>(sites.map((site) => site.id));
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [done, setDone] = useState(false);

  function pick(period: Period) {
    setFrom(period.from);
    setTo(period.to);
  }

  function toggleSite(id: string) {
    setSiteIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setErrorKey(null);
    setDone(false);
    const result = await action({ from, to, siteIds });
    setSubmitting(false);
    if (!result.ok) {
      setErrorKey(result.errorKey ?? "exports.errorGeneric");
      return;
    }
    setDone(true);
    router.refresh();
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4"
    >
      <Heading level={2}>{t("exports.createHeading")}</Heading>

      {done ? (
        <Alert tone="success" onDismiss={() => setDone(false)}>
          {t("exports.created")}
        </Alert>
      ) : null}
      {errorKey ? (
        <Alert tone="error" onDismiss={() => setErrorKey(null)}>
          {t(errorKey)}
        </Alert>
      ) : null}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-semibold">
          {t("exports.quickPicksLabel")}
        </legend>
        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => pick(quickPicks.previousMonth)}
          >
            {t("exports.previousMonth")}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="md"
            onClick={() => pick(quickPicks.thisMonth)}
          >
            {t("exports.thisMonth")}
          </Button>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4">
        <Field id="export-from" label={t("exports.fromLabel")}>
          <TextInput
            id="export-from"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            required
          />
        </Field>
        <Field id="export-to" label={t("exports.toLabel")}>
          <TextInput
            id="export-to"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            required
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-lg font-semibold">{t("exports.sitesLabel")}</legend>
        <Stack gap="sm">
          {sites.map((site) => (
            <label
              key={site.id}
              className="flex min-h-touch-target items-center gap-3 text-lg"
            >
              <input
                type="checkbox"
                className="size-6"
                checked={siteIds.includes(site.id)}
                onChange={() => toggleSite(site.id)}
              />
              {site.name}
            </label>
          ))}
        </Stack>
      </fieldset>

      <div>
        <Button type="submit" variant="primary" size="md" loading={submitting}>
          {t("exports.submit")}
        </Button>
      </div>
    </form>
  );
}
