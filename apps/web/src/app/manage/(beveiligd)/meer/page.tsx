import {
  Clock,
  FileDown,
  ScrollText,
  Settings,
  ShieldCheck,
  Tablet,
} from "lucide-react";

import { t } from "@cloxa/i18n";

import { ManageSessionRows } from "@/components/manage/ManageAccount";
import { List, Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";

export default async function ManageMeerPage() {
  const context = await requireManager();
  await previewHold();
  const isOrgAdmin =
    context.membership.role === "owner" || context.membership.role === "admin";

  return (
    <PageTransition>
      <NavBar title={t("manageMore.heading")} />
      <List className="pb-10">
        <Section>
          <Row
            href="/manage/meer/exports"
            icon={FileDown}
            title={t("exports.moreLink")}
          />
          {isOrgAdmin ? (
            <>
              <Row
                href="/manage/meer/instellingen"
                icon={Settings}
                title={t("manageMore.settings")}
              />
              <Row
                href="/manage/meer/kiosks"
                icon={Tablet}
                title={t("manageKiosks.moreLink")}
              />
              <Row
                href="/manage/meer/audit"
                icon={ScrollText}
                title={t("audit.moreLink")}
              />
            </>
          ) : null}
        </Section>
        <Section>
          <Row
            href="/manage/beveiliging/instellen"
            icon={ShieldCheck}
            title={t("manageMore.security")}
          />
          {context.employeeId !== null ? (
            <Row href="/app" icon={Clock} title={t("manageNav.switchToEmployee")} />
          ) : null}
        </Section>
        <ManageSessionRows />
      </List>
    </PageTransition>
  );
}
