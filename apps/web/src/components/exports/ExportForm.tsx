"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { formatBrusselsDate, t, type CatalogKey } from "@cloxa/i18n";

import type { ExportFormInput } from "@/lib/exports/form";

import { Button } from "../ui/Button";
import { ListItem, Row, Section } from "../ui/List";
import { Notice } from "../ui/Notice";
import { SegmentedControl } from "../ui/SegmentedControl";
import { inputClassName } from "../ui/TextInput";
import { cx } from "../ui/cx";

interface Period {
  readonly from: string;
  readonly to: string;
}

export interface ExportFormProps {
  sites: readonly { id: string; name: string }[];
  /** Interim agencies to export one of (ADR 008); empty hides the choice. */
  agencies?: readonly string[];
  quickPicks: { previousMonth: Period; thisMonth: Period };
  action: (input: ExportFormInput) => Promise<{ ok: boolean; errorKey?: CatalogKey }>;
}

type Pick = "previous" | "this" | "custom";

// Noon UTC is the same calendar day in Brussels all year round.
const day = (key: string) =>
  key ? formatBrusselsDate(new Date(`${key}T12:00:00Z`)) : t("common.none");

const DATE_INPUT = cx(inputClassName, "bg-paper tabular-nums");

/**
 * The period as quick picks (last month, this month, or your own dates) and
 * the sites; every visible site is ticked by default.
 */
export function ExportForm({
  sites,
  agencies = [],
  quickPicks,
  action,
}: ExportFormProps) {
  const router = useRouter();
  const [pick, setPick] = useState<Pick>("previous");
  const [from, setFrom] = useState(quickPicks.previousMonth.from);
  const [to, setTo] = useState(quickPicks.previousMonth.to);
  const [siteIds, setSiteIds] = useState<string[]>(sites.map((site) => site.id));
  const [agency, setAgency] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<CatalogKey | null>(null);
  const [done, setDone] = useState(false);

  function choose(next: Pick) {
    setPick(next);
    setDone(false);
    const period =
      next === "previous"
        ? quickPicks.previousMonth
        : next === "this"
          ? quickPicks.thisMonth
          : null;
    if (period) {
      setFrom(period.from);
      setTo(period.to);
    }
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
    const result = await action({
      from,
      to,
      siteIds,
      ...(agency ? { interimAgency: agency } : {}),
    });
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
      className="flex flex-col gap-8"
    >
      <section className="flex flex-col gap-3">
        <h2 className="px-4 text-subhead text-ink-2">{t("exports.periodLabel")}</h2>
        <SegmentedControl
          label={t("exports.quickPicksLabel")}
          value={pick}
          onValueChange={choose}
          options={[
            { value: "previous", label: t("exports.previousMonth") },
            { value: "this", label: t("exports.thisMonth") },
            { value: "custom", label: t("exports.customPeriod") },
          ]}
        />
        <Section>
          {pick === "custom" ? (
            <ListItem className="py-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-subhead text-ink-2">
                    {t("exports.fromLabel")}
                  </span>
                  <input
                    id="export-from"
                    type="date"
                    value={from}
                    required
                    onChange={(event) => setFrom(event.target.value)}
                    className={DATE_INPUT}
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-subhead text-ink-2">
                    {t("exports.toLabel")}
                  </span>
                  <input
                    id="export-to"
                    type="date"
                    value={to}
                    required
                    onChange={(event) => setTo(event.target.value)}
                    className={DATE_INPUT}
                  />
                </label>
              </div>
            </ListItem>
          ) : (
            <Row title={t("exports.periodValue", { from: day(from), to: day(to) })} />
          )}
        </Section>
      </section>

      <fieldset className="flex flex-col gap-2">
        <legend className="px-4 pb-2 text-subhead text-ink-2">
          {t("exports.sitesLabel")}
        </legend>
        <Section>
          {sites.map((site) => (
            <ListItem key={site.id} className="py-0">
              <label className="flex min-h-row cursor-pointer items-center gap-3 text-body">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-ink"
                  checked={siteIds.includes(site.id)}
                  onChange={() => toggleSite(site.id)}
                />
                <span className="min-w-0 truncate">{site.name}</span>
              </label>
            </ListItem>
          ))}
        </Section>
      </fieldset>

      {agencies.length > 0 ? (
        <Section footer={t("exports.agencyFooter")}>
          <ListItem className="py-3">
            <label className="flex flex-col gap-1">
              <span className="text-subhead text-ink-2">
                {t("exports.agencyLabel")}
              </span>
              <select
                id="export-agency"
                value={agency}
                onChange={(event) => {
                  setAgency(event.target.value);
                  setDone(false);
                }}
                className={DATE_INPUT}
              >
                <option value="">{t("exports.agencyAll")}</option>
                {agencies.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </ListItem>
        </Section>
      ) : null}

      <div className="flex flex-col gap-4">
        {done ? (
          <Notice tone="success" onDismiss={() => setDone(false)}>
            {t("exports.created")}
          </Notice>
        ) : null}
        {errorKey ? (
          <Notice tone="error" onDismiss={() => setErrorKey(null)}>
            {t(errorKey)}
          </Notice>
        ) : null}
        <Button type="submit" wide loading={submitting}>
          {t("exports.submit")}
        </Button>
      </div>
    </form>
  );
}
