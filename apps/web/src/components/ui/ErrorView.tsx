import type { LucideIcon } from "lucide-react";
import { CloudAlert } from "lucide-react";

import { t } from "@cloxa/i18n";

import { Button } from "./Button";

export interface ErrorViewProps {
  /** Retries the failed load: `retry` from `error.tsx`. */
  onRetry: () => void;
  title?: string;
  body?: string;
  icon?: LucideIcon;
  /** `h1` when it replaces a whole page (the default), `h2` inside one. */
  headingLevel?: 1 | 2;
}

/**
 * A calm page-level error: an icon, one heading, one sentence, and
 * "Opnieuw proberen". Form errors stay inline, next to their field.
 */
export function ErrorView({
  onRetry,
  title = t("errors.genericTitle"),
  body = t("errors.genericBody"),
  icon: Icon = CloudAlert,
  headingLevel = 1,
}: ErrorViewProps) {
  const Heading = `h${headingLevel}` as const;

  return (
    <div
      role="alert"
      className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center"
    >
      <span
        aria-hidden="true"
        className="mb-3 flex size-16 items-center justify-center rounded-clock bg-fill text-ink-2"
      >
        <Icon className="size-8" strokeWidth={1.5} />
      </span>
      <Heading className="text-title-2">{title}</Heading>
      <p className="max-w-sm text-body text-ink-2">{body}</p>
      <div className="mt-4">
        <Button onClick={onRetry}>{t("errors.retry")}</Button>
      </div>
    </div>
  );
}
