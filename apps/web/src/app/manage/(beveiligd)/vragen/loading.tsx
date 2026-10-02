import { t } from "@cloxa/i18n";

import { Skeleton, SkeletonTitle } from "@/components/ui/Skeleton";

/** Aanvragen while it loads: the segments and a few request rows. */
export default function RequestsLoading() {
  return (
    <div role="status" className="flex flex-col pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <SkeletonTitle />
      <div
        aria-hidden="true"
        className="flex flex-col gap-5 px-gutter md:px-gutter-desktop"
      >
        <Skeleton className="h-touch-target w-full max-w-readable rounded-[14px]" />
        {[0, 1, 2].map((card) => (
          <div
            key={card}
            className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-card"
          >
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3.5 w-56" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-16 rounded-control" />
              <Skeleton className="h-16 rounded-control" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
