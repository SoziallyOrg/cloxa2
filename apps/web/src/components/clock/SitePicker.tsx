import { MapPin } from "lucide-react";

import { t } from "@cloxa/i18n";

import { AccountButton } from "../employee/Account";
import { List, Row, Section } from "../ui/List";
import { NavBar } from "../ui/NavBar";

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
  // Klok's frame is plain white; this list needs the grouped background.
  return (
    <div className="flex flex-1 flex-col bg-grouped">
      <NavBar
        title={t("sitePicker.title")}
        trailing={<AccountButton placement="bar" />}
      />
      {/* One form per site; the rows submit them via `form=` (a form can't sit in a list). */}
      {sites.map((site) => (
        <form key={site.id} id={`site-${site.id}`} action={action} hidden>
          <input type="hidden" name="siteId" value={site.id} />
        </form>
      ))}
      <List className="pb-10">
        <Section footer={t("sitePicker.intro")}>
          {sites.map((site) => (
            <Row
              key={site.id}
              type="submit"
              form={`site-${site.id}`}
              icon={MapPin}
              tile="blue"
              title={site.name}
              chevron
            />
          ))}
        </Section>
      </List>
    </div>
  );
}
