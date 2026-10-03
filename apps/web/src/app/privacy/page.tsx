import type { Metadata } from "next";

import { privacyDocument, t } from "@cloxa/i18n";

import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: t("legal.metaPrivacy") };

export default function PrivacyPage() {
  return <LegalPage document={privacyDocument} />;
}
