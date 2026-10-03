"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { t } from "@cloxa/i18n";

import { Row, Section } from "../ui/List";

export interface AuditPagerProps {
  /** True once the viewer has moved past the first page. */
  hasPrevious: boolean;
  /** Absolute path + query for the next page, or null on the last page. */
  nextHref: string | null;
}

/** "Vorige" goes back in browser history (each page is its own URL); "Volgende" navigates. */
export function AuditPager({ hasPrevious, nextHref }: AuditPagerProps) {
  const router = useRouter();

  if (!hasPrevious && !nextHref) return null;

  return (
    <Section>
      {hasPrevious ? (
        <Row
          icon={ChevronLeft}
          title={t("audit.previousPage")}
          onClick={() => router.back()}
        />
      ) : null}
      {nextHref ? <Row href={nextHref} title={t("audit.nextPage")} /> : null}
    </Section>
  );
}
