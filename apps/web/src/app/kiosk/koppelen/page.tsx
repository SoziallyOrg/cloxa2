import { t } from "@cloxa/i18n";

import { KioskShell } from "@/components/kiosk/KioskShell";
import { PairForm } from "@/components/kiosk/PairForm";
import { Heading } from "@/components/ui/Heading";

import { pairKioskAction } from "./actions";

/** Pairing a tablet: one big field for the code the admin got in `/manage`. */
export default function KioskPairPage() {
  return (
    <main>
      <KioskShell className="items-center justify-center p-6">
        <div className="flex w-full max-w-lg flex-col gap-6 rounded-hero bg-card p-8 shadow-card">
          <Heading level={1}>{t("kiosk.pairTitle")}</Heading>
          <p className="text-body">{t("kiosk.pairIntro")}</p>
          <PairForm action={pairKioskAction} />
        </div>
      </KioskShell>
    </main>
  );
}
