import { Download, KeyRound } from "lucide-react";

import { t } from "@cloxa/i18n";

import { AccountCard } from "@/components/employee/Account";
import { SettingsSessionRows } from "@/components/employee/SettingsSessionRows";
import { List, Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireEmployeeArea } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

/** `/app/instellingen`: the kiosk PIN, a download of all one's own data, sign-out. */
export default async function EmployeeSettingsPage() {
  const context = await requireEmployeeArea();
  await previewHold();
  const supabase = await createClient();

  // Whether a PIN is set, never the PIN (the hash column is not even granted).
  const { data: pin, error } = await supabase
    .from("employee_pins")
    .select("set_at")
    .eq("employee_id", context.employeeId)
    .maybeSingle();
  if (error) throw new Error(`employee_pins_unavailable:${error.code}`);

  return (
    <PageTransition>
      <NavBar title={t("kiosk.settingsTitle")} />
      <List className="pb-10 lg:max-w-readable">
        <AccountCard />
        <Section footer={t("kiosk.pinSettingsIntro")}>
          <Row
            href="/app/instellingen/pincode"
            icon={KeyRound}
            title={t("kiosk.menuLink")}
            value={pin ? t("kiosk.pinStateSet") : t("kiosk.pinStateNotSet")}
          />
        </Section>
        <Section footer={t("myData.intro")}>
          <Row
            href="/app/instellingen/mijn-gegevens"
            download
            icon={Download}
            title={t("myData.download")}
            subtitle={t("myData.format")}
          />
        </Section>
        <SettingsSessionRows employeeId={context.employeeId} />
      </List>
    </PageTransition>
  );
}
