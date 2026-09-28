"use client";

import { useRouter } from "next/navigation";

import { t } from "@cloxa/i18n";

export interface SiteFilterOption {
  readonly id: string;
  readonly name: string;
}

export interface SiteFilterProps {
  sites: readonly SiteFilterOption[];
  selectedSiteId: string | null;
}

/** Only rendered by the caller when there is more than one visible site. */
export function SiteFilter({ sites, selectedSiteId }: SiteFilterProps) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-3 text-lg font-semibold">
      {t("manage.siteFilterLabel")}
      <select
        className="focus-ring min-h-touch-target rounded-md border-2 border-border bg-surface px-4 text-lg text-ink"
        value={selectedSiteId ?? ""}
        onChange={(event) => {
          const value = event.target.value;
          router.push(value ? `/manage?site=${value}` : "/manage");
        }}
      >
        <option value="">{t("manage.siteFilterAll")}</option>
        {sites.map((site) => (
          <option key={site.id} value={site.id}>
            {site.name}
          </option>
        ))}
      </select>
    </label>
  );
}
