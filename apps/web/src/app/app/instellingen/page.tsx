import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { PinForm } from "@/components/kiosk/PinForm";
import { buttonClassName } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { requireEmployeeArea } from "@/lib/auth/context";
import { createClient } from "@/lib/supabase/server";

import { setMyPinAction } from "./actions";

/** `/app/instellingen`: the kiosk PIN and a download of all one's own data. */
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
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-6 px-4 py-6">
      <Link
        href={"/app" as Route}
        className="focus-ring self-start font-semibold text-primary underline"
      >
        {t("kiosk.settingsBack")}
      </Link>
      <Heading level={1}>{t("kiosk.settingsTitle")}</Heading>
      <section className="flex flex-col gap-4">
        <Heading level={2}>{t("kiosk.pinSettingsHeading")}</Heading>
        <p className="text-lg">{t("kiosk.pinSettingsIntro")}</p>
        <p className="text-lg">{t("kiosk.pinAllEmployers")}</p>
        {pin ? <p className="text-lg text-ink/70">{t("kiosk.pinIsSet")}</p> : null}
        <PinForm
          id="my-pin"
          submitLabel={t("kiosk.pinSubmit")}
          savedMessage={t("kiosk.pinSaved")}
          action={setMyPinAction}
        />
      </section>
      <section className="flex flex-col gap-4">
        <Heading level={2}>{t("myData.heading")}</Heading>
        <p className="text-lg">{t("myData.intro")}</p>
        <a
          href="/app/instellingen/mijn-gegevens"
          download
          className={`${buttonClassName("secondary", "md")} self-start`}
        >
          {t("myData.download")}
        </a>
      </section>
    </main>
  );
}
