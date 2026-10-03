import type { Metadata } from "next";

import { dpaDocument, t } from "@cloxa/i18n";

import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: t("legal.metaDpa") };

export default function DpaPage() {
  return <LegalPage document={dpaDocument} />;
}
