import { t } from "@cloxa/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-4 px-gutter">
      <h1 className="text-title">{t("errors.notFoundTitle")}</h1>
      <p className="text-body text-ink-2">{t("errors.notFoundBody")}</p>
    </main>
  );
}
