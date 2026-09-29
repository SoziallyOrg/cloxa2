import type { Metadata } from "next";

import { t } from "@cloxa/i18n";

import { PilotForm } from "@/components/site/PilotForm";
import { SITE_WIDTH, SiteChrome } from "@/components/site/SiteChrome";
import { turnstileSiteKey } from "@/lib/auth/turnstile";

export const metadata: Metadata = {
  title: t("pilot.metaTitle"),
  description: t("pilot.metaDescription"),
};

export default function PilotRequestPage() {
  return (
    <SiteChrome>
      <div className={`${SITE_WIDTH} max-w-xl pt-8 pb-8 md:pt-16`}>
        <h1 className="text-large-title md:text-[44px] md:leading-[1.1]">
          {t("pilot.title")}
        </h1>
        <p className="mt-4 mb-10 text-body text-ink-2">{t("pilot.intro")}</p>
        <PilotForm turnstileSiteKey={turnstileSiteKey()} />
      </div>
    </SiteChrome>
  );
}
