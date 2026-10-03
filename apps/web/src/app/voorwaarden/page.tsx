import type { Metadata } from "next";

import { t, termsDocument } from "@cloxa/i18n";

import { LegalPage } from "@/components/site/LegalPage";

export const metadata: Metadata = { title: t("legal.metaTerms") };

export default function TermsPage() {
  return <LegalPage document={termsDocument} />;
}
