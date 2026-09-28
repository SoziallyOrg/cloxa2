import { t } from "@cloxa/i18n";

import { PairForm } from "@/components/kiosk/PairForm";
import { Heading } from "@/components/ui/Heading";

import { pairKioskAction } from "./actions";

/** Pairing a tablet: one big field for the code the admin got in `/manage`. */
export default function KioskPairPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
      <Heading level={1}>{t("kiosk.pairTitle")}</Heading>
      <p className="text-lg">{t("kiosk.pairIntro")}</p>
      <PairForm action={pairKioskAction} />
    </main>
  );
}
