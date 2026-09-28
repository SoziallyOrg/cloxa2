import { t } from "@cloxa/i18n";

// TODO(kiosk): public for now. Before it shows or records anything, gate it
// with a site-bound device token (ADR 002); never a personal session.
export default function KioskPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-semibold">{t("kiosk.heading")}</h1>
    </main>
  );
}
