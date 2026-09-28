"use client";

import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-gutter">
      <h1 className="text-title">{t("errors.genericTitle")}</h1>
      <p className="text-body text-ink-2">{t("errors.genericBody")}</p>
      <Button type="button" wide onClick={reset}>
        {t("errors.retry")}
      </Button>
    </main>
  );
}
