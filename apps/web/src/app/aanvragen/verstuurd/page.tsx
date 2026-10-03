import type { Metadata } from "next";
import Link from "next/link";

import { t } from "@cloxa/i18n";

import { SITE_WIDTH, SiteChrome } from "@/components/site/SiteChrome";
import { buttonClassName } from "@/components/ui/Button";

// A thank-you page has no business in a search index.
export const metadata: Metadata = {
  title: t("pilot.sent.metaTitle"),
  robots: { index: false },
};

export default function PilotRequestSentPage() {
  return (
    <SiteChrome>
      <div className={`${SITE_WIDTH} max-w-xl pt-8 md:pt-16`}>
        <h1 className="text-large-title md:text-[44px] md:leading-[1.1]">
          {t("pilot.sent.title")}
        </h1>
        <p role="status" className="mt-4 text-body">
          {t("pilot.sent.body")}
        </p>
        <p className="mt-2 text-body text-ink-2">{t("pilot.sent.note")}</p>
        <div className="mt-10">
          <Link href="/" className={buttonClassName("primary", "md", true)}>
            {t("pilot.sent.home")}
          </Link>
        </div>
      </div>
    </SiteChrome>
  );
}
