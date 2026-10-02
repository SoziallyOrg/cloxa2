import { t } from "@cloxa/i18n";

import { Skeleton, SkeletonTitle } from "@/components/ui/Skeleton";

/** Vragen while it loads: question cards with their status and the Was / Wordt tiles. */
export default function QuestionsLoading() {
  return (
    <div role="status" className="flex flex-col gap-2 pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <SkeletonTitle />
      <div
        aria-hidden="true"
        className="grid gap-3 px-gutter md:px-gutter-desktop lg:grid-cols-2"
      >
        {Array.from({ length: 3 }, (_, card) => (
          <div
            key={card}
            className="flex flex-col gap-3 rounded-card bg-card p-4 shadow-card"
          >
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-2">
                <Skeleton className="h-5 w-40" />
                <Skeleton className="h-3.5 w-20" />
              </div>
              <Skeleton className="h-7 w-24 rounded-lg" />
            </div>
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
