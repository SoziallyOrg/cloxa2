import { t } from "@cloxa/i18n";

import { Skeleton } from "@/components/ui/Skeleton";

/** Klok while it loads: status, timer and the action at the bottom (the frame brings the header). */
export default function KlokLoading() {
  return (
    <div role="status" className="flex flex-1 flex-col">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <div
        aria-hidden="true"
        className="flex flex-1 flex-col px-gutter pb-6 md:justify-center md:px-gutter-desktop md:py-16"
      >
        <div className="flex flex-col pt-8 md:pt-0">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-7 h-20 w-52 rounded-2xl" />
          <Skeleton className="mt-5 h-4 w-60" />
          <Skeleton className="mt-12 h-1.5 w-full rounded-full" />
          <div className="mt-3 flex justify-between">
            <Skeleton className="h-3.5 w-12" />
            <Skeleton className="h-3.5 w-28" />
          </div>
        </div>
        <Skeleton className="mt-auto h-primary-action w-full rounded-clock md:mt-14" />
      </div>
    </div>
  );
}
