import { t } from "@cloxa/i18n";

export default function LandingPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      {/* Plain <img>: next/image adds an inline style attribute that the nonce CSP blocks. */}
      <img
        src="/branding/cloxa-compact.svg"
        alt={t("common.appName")}
        width={160}
        height={48}
      />
      <h1 className="text-3xl font-semibold">{t("landing.title")}</h1>
      <p className="text-lg">{t("landing.subtitle")}</p>
    </main>
  );
}
