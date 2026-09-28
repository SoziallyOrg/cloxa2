import { t } from "@cloxa/i18n";

import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { PullToRefresh } from "@/components/ui/PullToRefresh";

import { PreviewContent } from "./PreviewContent";

export default function PreviewPage() {
  return (
    <PageTransition>
      <PullToRefresh>
        <NavBar title={t("preview.heading")} subtitle={t("preview.fakeDataLabel")} />
        <PreviewContent />
      </PullToRefresh>
    </PageTransition>
  );
}
