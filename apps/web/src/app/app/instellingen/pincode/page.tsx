import { t } from "@cloxa/i18n";

import { PinForm } from "@/components/kiosk/PinForm";
import { BackLink } from "@/components/ui/BackLink";
import { requireEmployeeArea } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import { setMyPinAction } from "../actions";

/** `/app/instellingen/pincode`: choose the PIN used on the kiosk tablet. */
export default async function KioskPinPage() {
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
    <div className="flex flex-1 flex-col gap-8 pt-2 md:pt-0">
      <div className="flex flex-col gap-3">
        <BackLink href="/app/instellingen" label={t("kiosk.settingsTitle")} />
        <h1 className="text-title">{t("kiosk.pinSettingsHeading")}</h1>
        <p className="text-body text-ink-2">{t("kiosk.pinSettingsIntro")}</p>
        <p className="text-body text-ink-2">{t("kiosk.pinAllEmployers")}</p>
        {pin ? <p className="text-body text-ink-2">{t("kiosk.pinIsSet")}</p> : null}
      </div>
      <PinForm
        id="my-pin"
        submitLabel={t("kiosk.pinSubmit")}
        savedMessage={t("kiosk.pinSaved")}
        action={setMyPinAction}
      />
    </div>
  );
}
