import { t } from "@cloxa/i18n";

import { SettingsSessionRows } from "@/components/employee/SettingsSessionRows";
import { GroupedList, ListLinkRow } from "@/components/ui/GroupedList";
import { requireEmployeeArea } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

/** `/app/instellingen`: the kiosk PIN, a download of all one's own data, sign-out. */
export default async function EmployeeSettingsPage() {
  const context = await requireEmployeeArea();
  const supabase = await createClient();

  // Whether a PIN is set, never the PIN (the hash column is not even granted).
  const { data: pin, error } = await supabase
    .from("employee_pins")
    .select("set_at")
    .eq("employee_id", context.employeeId)
    .maybeSingle();
  if (error) throw new Error(`employee_pins_unavailable:${error.code}`);

  return (
    <div className="flex flex-col gap-8 pt-6 md:pt-0">
      <h1 className="text-title">{t("kiosk.settingsTitle")}</h1>
      <GroupedList footer={t("kiosk.pinSettingsIntro")}>
        <ListLinkRow
          href="/app/instellingen/pincode"
          title={t("kiosk.menuLink")}
          value={pin ? t("kiosk.pinStateSet") : t("kiosk.pinStateNotSet")}
        />
      </GroupedList>
      <GroupedList footer={t("myData.intro")}>
        <ListLinkRow
          href="/app/instellingen/mijn-gegevens"
          download
          title={t("myData.download")}
          value={t("myData.format")}
        />
      </GroupedList>
      <SettingsSessionRows employeeId={context.employeeId} />
    </div>
  );
}
