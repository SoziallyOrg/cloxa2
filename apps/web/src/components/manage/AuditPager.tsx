"use client";

import { useRouter } from "next/navigation";

import { t } from "@cloxa/i18n";

import { Button } from "../ui/Button";

export interface AuditPagerProps {
  /** True once the viewer has moved past the first page. */
  hasPrevious: boolean;
  /** Absolute path + query for the next page, or null on the last page. */
  nextHref: string | null;
}

/** "Vorige" goes back in browser history (each page is its own URL); "Volgende" is a plain navigation. */
export function AuditPager({ hasPrevious, nextHref }: AuditPagerProps) {
  const router = useRouter();

  if (!hasPrevious && !nextHref) return null;

  return (
    <div className="flex flex-wrap gap-3">
      {hasPrevious ? (
        <Button variant="secondary" size="md" onClick={() => router.back()}>
          {t("audit.previousPage")}
        </Button>
      ) : null}
      {nextHref ? (
        <a
          href={nextHref}
          className="focus-ring inline-flex min-h-touch-target items-center rounded-md border-2 border-ink px-6 text-lg font-semibold text-ink"
        >
          {t("audit.nextPage")}
        </a>
      ) : null}
    </div>
  );
}
