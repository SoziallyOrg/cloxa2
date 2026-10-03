import { t } from "@cloxa/i18n";

import { Logo } from "@/components/brand/Logo";
import { NotFoundView } from "@/components/ui/NotFoundView";

/** Any unknown address: on paper, with the logo and a way back to the start. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col bg-paper">
      <div className="px-gutter pt-6 md:px-gutter-desktop">
        <Logo size="lg" />
      </div>
      <NotFoundView href="/" label={t("errors.notFoundHome")} />
    </main>
  );
}
