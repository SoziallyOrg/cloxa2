"use client";

import { t } from "@cloxa/i18n";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-semibold">{t("errors.genericTitle")}</h1>
      <p className="text-lg">{t("errors.genericBody")}</p>
      <button
        type="button"
        onClick={reset}
        className="min-h-touch-target rounded-md bg-primary px-6 py-3 text-lg text-paper"
      >
        {t("errors.retry")}
      </button>
    </main>
  );
}
