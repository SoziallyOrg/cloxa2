import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";
import { currentChoices, MODULES } from "@cloxa/modules";

import { ModuleSwitchSection } from "@/components/modules/ModuleSwitchSection";
import { List, ListItem, Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { loadOrgModuleRows } from "@/lib/modules/load";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { setModuleEnabledAction } from "./actions";

/** Owners and admins: one group per module (switch, one sentence, its page), then CIAO. */
export default async function ManageModulesPage() {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  await previewHold();
  const rows = await loadOrgModuleRows(
    await createClient(),
    context.membership.organizationId,
  );

  return (
    <PageTransition>
      <NavBar
        title={t("modules.heading")}
        subtitle={t("modules.intro")}
        back={{ href: "/manage/meer", label: t("manageMore.heading") }}
      />
      <List className="pb-10">
        {MODULES.map((module) => {
          const row = rows.get(module.id);
          // A module with settings shows its current choice on the link row.
          const [choice] = module.configChoices;
          const chosen = choice
            ? choice.options.find(
                (option) =>
                  option.value === currentChoices(module, row?.config)[choice.key],
              )
            : undefined;
          return (
            <ModuleSwitchSection
              key={module.id}
              moduleId={module.id}
              label={t(module.label)}
              summary={t(module.summary)}
              enabled={row?.enabled ?? false}
              action={setModuleEnabledAction.bind(null, module.id)}
            >
              <Row
                href={`/manage/meer/modules/${module.id}`}
                title={choice ? t(choice.label) : t("modules.detailLink")}
                value={chosen ? t(chosen.label) : undefined}
              />
            </ModuleSwitchSection>
          );
        })}

        <Section footer={t("modules.listFooter")}>
          <ListItem className="gap-1 py-3">
            <p className="text-body">{t("modules.ciaoTitle")}</p>
            <p className="text-subhead text-ink-2">{t("modules.ciaoBody")}</p>
          </ListItem>
        </Section>
      </List>
    </PageTransition>
  );
}
