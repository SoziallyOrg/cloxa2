"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";

import { t } from "@cloxa/i18n";

import { ActionSheet } from "../ui/ActionSheet";

export interface SiteFilterOption {
  readonly id: string;
  readonly name: string;
}

export interface SiteFilterProps {
  sites: readonly SiteFilterOption[];
  selectedSiteId: string | null;
}

/**
 * A quiet trailing bar button with the current site; the choice is an
 * action sheet. Only rendered when there is more than one visible site.
 */
export function SiteFilter({ sites, selectedSiteId }: SiteFilterProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const current =
    sites.find((site) => site.id === selectedSiteId)?.name ?? t("manage.siteFilterAll");

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="focus-ring inline-flex h-bar-button max-w-[45vw] min-w-bar-button pressable items-center gap-1 rounded-control px-2 text-body text-ink md:max-w-xs"
      >
        <span className="sr-only">{t("manage.siteFilterLabel")}: </span>
        <span className="truncate">{current}</span>
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0"
          strokeWidth={2.25}
        />
      </button>
      <ActionSheet
        open={open}
        onClose={() => setOpen(false)}
        title={t("manage.siteFilterTitle")}
        actions={[
          {
            key: "all",
            label: t("manage.siteFilterAll"),
            onSelect: () => router.replace("/manage"),
          },
          ...sites.map((site) => ({
            key: site.id,
            label: site.name,
            onSelect: () => router.replace(`/manage?site=${site.id}`),
          })),
        ]}
      />
    </>
  );
}
