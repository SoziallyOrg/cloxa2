import { t } from "@cloxa/i18n";

import { Skeleton } from "@/components/ui/Skeleton";

/** Klok while it loads: the status block with its ring and button, then "Vandaag" rows. */
export default function KlokLoading() {
  return (
    <div role="status" className="flex flex-1 flex-col">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <div
        aria-hidden="true"
        className="flex flex-1 flex-col lg:grid lg:grid-cols-[420px_minmax(0,1fr)] lg:content-start lg:items-start lg:gap-8 lg:p-8"
      >
        <div className="flex flex-col items-center rounded-b-hero bg-card px-5 pt-16 pb-6 shadow-card lg:rounded-clock lg:pt-8">
          <Skeleton className="size-[250px] rounded-full" />
          <Skeleton className="mt-6 h-[76px] w-full rounded-clock" />
          <Skeleton className="mt-3 h-14 w-full rounded-control" />
        </div>
        <div className="flex flex-col gap-2 px-gutter pt-6 lg:p-0">
          <Skeleton className="mb-1 ml-1 h-3.5 w-20" />
          <Skeleton className="h-12 w-full rounded-control" />
          <Skeleton className="h-12 w-full rounded-control" />
          <Skeleton className="h-12 w-full rounded-control" />
        </div>
      </div>
    </div>
  );
}
