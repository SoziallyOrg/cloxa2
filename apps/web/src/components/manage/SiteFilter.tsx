"use client";

import { useRouter } from "next/navigation";

import { t } from "@cloxa/i18n";

import { Select } from "../ui/Select";

export interface SiteFilterOption {
  readonly id: string;
  readonly name: string;
}

export interface SiteFilterProps {
  sites: readonly SiteFilterOption[];
  selectedSiteId: string | null;
}

/** A quiet select; only rendered by the caller when there is more than one site. */
export function SiteFilter({ sites, selectedSiteId }: SiteFilterProps) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-3 text-callout text-ink-2">
      {t("manage.siteFilterLabel")}
      <Select
        quiet
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
      </Select>
    </label>
  );
}
