import { t } from "@cloxa/i18n";

import { GroupedList, ListButtonRow } from "../ui/GroupedList";

export interface SitePickerOption {
  readonly id: string;
  readonly name: string;
}

export interface SitePickerProps {
  sites: readonly SitePickerOption[];
  action: (formData: FormData) => void | Promise<void>;
}

/**
 * Shown once to an employee assigned to more than one site, until they pick
 * one (remembered in a cookie). One row per site: no dropdown, no typing.
 */
export function SitePicker({ sites, action }: SitePickerProps) {
  return (
    <div className="flex flex-col gap-8 pt-6 md:pt-0">
      <div className="flex flex-col gap-3">
        <h1 className="text-title">{t("sitePicker.title")}</h1>
        <p className="text-body text-ink-2">{t("sitePicker.intro")}</p>
      </div>
      {/* One form per site; the rows submit them via `form=` (a form can't sit in a list). */}
      {sites.map((site) => (
        <form key={site.id} id={`site-${site.id}`} action={action} hidden>
          <input type="hidden" name="siteId" value={site.id} />
        </form>
      ))}
      <GroupedList>
        {sites.map((site) => (
          <ListButtonRow
            key={site.id}
            type="submit"
            form={`site-${site.id}`}
            title={site.name}
            chevron
          />
        ))}
      </GroupedList>
    </div>
  );
}
