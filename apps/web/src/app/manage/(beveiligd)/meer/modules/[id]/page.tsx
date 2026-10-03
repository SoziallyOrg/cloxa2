import { notFound, redirect } from "next/navigation";

import { t } from "@cloxa/i18n";
import { currentChoices, isModuleId, moduleById } from "@cloxa/modules";

import { ModuleConfigChoices } from "@/components/modules/ModuleConfigChoices";
import { ModuleSwitchSection } from "@/components/modules/ModuleSwitchSection";
import { List, ListItem, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { loadOrgModuleRows } from "@/lib/modules/load";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { setModuleConfigAction, setModuleEnabledAction } from "../actions";

/** One module: the switch, what it does, and its settings (if it has any). */
export default async function ManageModuleDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  const { id } = await params;
  if (!isModuleId(id)) notFound();
  await previewHold();
  const definition = moduleById(id);
  const row = (
    await loadOrgModuleRows(await createClient(), context.membership.organizationId)
  ).get(id);
  const label = t(definition.label);

  return (
    <PageTransition>
      <NavBar
        title={label}
        back={{ href: "/manage/meer/modules", label: t("modules.heading") }}
      />
      <List className="pb-10">
        <ModuleSwitchSection
          moduleId={definition.id}
          label={label}
          enabled={row?.enabled ?? false}
          action={setModuleEnabledAction.bind(null, definition.id)}
        />

        <Section header={t("modules.detailIntro")}>
          <ListItem className="py-3">
            <p className="text-body break-words">{t(definition.description)}</p>
          </ListItem>
        </Section>

        {definition.configChoices.length > 0 ? (
          <ModuleConfigChoices
            choices={definition.configChoices}
            initial={currentChoices(definition, row?.config)}
            action={setModuleConfigAction.bind(null, definition.id)}
          />
        ) : (
          <p className="px-4 text-subhead text-ink-2">{t("modules.noSettings")}</p>
        )}
      </List>
    </PageTransition>
  );
}
