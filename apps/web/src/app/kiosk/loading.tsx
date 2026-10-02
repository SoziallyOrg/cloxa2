import { t } from "@cloxa/i18n";

import { KioskHeader } from "@/components/kiosk/KioskShell";
import { Skeleton } from "@/components/ui/Skeleton";

/** The tablet while it loads: the brand bar and a grid of name tiles. */
export default function KioskLoading() {
  return (
    <div role="status" className="flex min-h-dvh flex-col bg-paper">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <KioskHeader />
      <div
        aria-hidden="true"
        className="mx-auto grid w-full max-w-5xl grid-cols-2 gap-4 p-6 md:grid-cols-3 md:p-8 lg:grid-cols-4"
      >
        {Array.from({ length: 8 }, (_, tile) => (
          <Skeleton key={tile} className="h-kiosk-tile rounded-clock" />
        ))}
      </div>
    </div>
  );
}
