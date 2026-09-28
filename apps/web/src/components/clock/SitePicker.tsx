import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";
import { Heading } from "../ui/Heading";
import { Stack } from "../ui/Stack";

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
 * one (remembered in a cookie). One button per site: no dropdown, no typing.
 */
export function SitePicker({ sites, action }: SitePickerProps) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 p-6">
      <Heading level={1}>{t("sitePicker.title")}</Heading>
      <p className="text-lg">{t("sitePicker.intro")}</p>
      <Stack gap="md">
        {sites.map((site) => (
          <form key={site.id} action={action}>
            <input type="hidden" name="siteId" value={site.id} />
            <Button type="submit" variant="secondary" size="xl">
              {site.name}
            </Button>
          </form>
        ))}
      </Stack>
    </main>
  );
}
