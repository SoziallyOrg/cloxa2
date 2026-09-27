import { t } from "@cloxa/i18n";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">{t("errors.notFoundTitle")}</h1>
      <p className="text-lg">{t("errors.notFoundBody")}</p>
    </main>
  );
}
