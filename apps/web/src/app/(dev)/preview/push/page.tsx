import { CalendarDays, Clock } from "lucide-react";

import { t } from "@cloxa/i18n";

import { List, Row, Section } from "@/components/ui/List";
import { NavBar, NavBarButton } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";

/** A pushed page: back button with the previous title, and the pop slide. */
export default function PreviewPushedPage() {
  return (
    <PageTransition>
      <NavBar
        title={t("preview.pushedTitle")}
        back={{ href: "/preview", label: t("preview.heading") }}
        trailing={
          <NavBarButton strong href="/preview">
            {t("ui.done")}
          </NavBarButton>
        }
      />
      <List className="pb-10">
        <Section footer={t("preview.pushedBody")}>
          <Row
            icon={Clock}
            tile="green"
            title={t("preview.rowWeek")}
            value={t("preview.rowWeekValue")}
          />
          <Row
            icon={CalendarDays}
            tile="blue"
            title={t("preview.rowSite")}
            value={t("preview.rowSiteValue")}
          />
        </Section>
      </List>
    </PageTransition>
  );
}
