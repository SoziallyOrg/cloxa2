import { t } from "@cloxa/i18n";

import { PinForm } from "@/components/kiosk/PinForm";
import { List } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireEmployeeArea } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { setMyPinAction } from "../actions";

/** `/app/instellingen/pincode`: choose the PIN used on the kiosk tablet. */
export default async function KioskPinPage() {
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
    <PageTransition className="flex flex-1 flex-col">
      <NavBar
        title={t("kiosk.pinSettingsHeading")}
        back={{ href: "/app/instellingen", label: t("kiosk.settingsTitle") }}
      />
      <List className="flex-1 lg:max-w-readable">
        <div className="flex flex-col gap-2 rounded-card bg-fill p-4 text-subhead text-ink-2">
          <p>{t("kiosk.pinSettingsIntro")}</p>
          <p>{t("kiosk.pinAllEmployers")}</p>
          {pin ? <p className="font-medium text-ink">{t("kiosk.pinIsSet")}</p> : null}
        </div>
        <PinForm
          id="my-pin"
          variant="list"
          submitLabel={t("kiosk.pinSubmit")}
          savedMessage={t("kiosk.pinSaved")}
          action={setMyPinAction}
        />
      </List>
    </PageTransition>
  );
}
