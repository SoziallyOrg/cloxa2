import { t } from "@cloxa/i18n";

import { Skeleton, SkeletonTitle } from "@/components/ui/Skeleton";

/** Aanvragen while it loads: the segments and two request groups. */
export default function RequestsLoading() {
  return (
    <div role="status" className="flex flex-col pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <SkeletonTitle />
      <div
        aria-hidden="true"
        className="flex flex-col gap-6 px-gutter md:px-gutter-desktop"
      >
        <Skeleton className="h-touch-target w-full rounded-[10px]" />
        {[0, 1].map((group) => (
          <div key={group} className="flex flex-col rounded-list bg-surface">
            <div className="flex flex-col gap-2 px-4 py-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-32" />
            </div>
            <div className="ml-4 flex flex-col gap-2 border-t-[0.5px] border-separator py-4 pr-4">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3.5 w-56" />
            </div>
            <div className="ml-4 flex flex-col gap-3 border-t-[0.5px] border-separator py-4 pr-4">
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-2 w-full" />
            </div>
            <div className="grid grid-cols-2 gap-3 border-t-[0.5px] border-separator p-3">
              <Skeleton className="h-control rounded-control" />
              <Skeleton className="h-control rounded-control" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
