import { t } from "@cloxa/i18n";

import { SessionActions } from "@/components/auth/SessionActions";
import { Heading } from "@/components/ui/Heading";
import { requireManager } from "@/lib/auth/context";

export default async function ManagePage() {
  // Layouts don't re-run on client navigation, so every page checks too.
  await requireManager();

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 p-6">
      <Heading level={1}>{t("manage.heading")}</Heading>
      <p className="text-lg">{t("manage.placeholder")}</p>
      <SessionActions everywhere />
    </main>
  );
}
