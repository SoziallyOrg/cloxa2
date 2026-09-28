import { t } from "@cloxa/i18n";

import { Logo } from "@/components/brand/Logo";

export default function LandingPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-gutter text-center">
      <Logo size="lg" />
      <h1 className="sr-only">{t("landing.title")}</h1>
      <p className="text-body text-ink-2">{t("landing.subtitle")}</p>
    </main>
  );
}
