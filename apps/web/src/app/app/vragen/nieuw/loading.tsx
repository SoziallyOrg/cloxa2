import { t } from "@cloxa/i18n";

import { Skeleton, SkeletonTitle } from "@/components/ui/Skeleton";

/** The correction wizard while it loads: the steps and three choices. */
export default function NewQuestionLoading() {
  return (
    <div role="status" className="flex flex-col gap-6 pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <SkeletonTitle />
      <div
        aria-hidden="true"
        className="flex flex-col gap-4 px-gutter md:px-gutter-desktop lg:max-w-readable"
      >
        <div className="flex gap-2">
          <Skeleton className="h-2 w-12 rounded-full" />
          <Skeleton className="h-2 w-12 rounded-full" />
          <Skeleton className="h-2 w-12 rounded-full" />
        </div>
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton className="h-16 w-full rounded-card" />
        <Skeleton className="h-16 w-full rounded-card" />
      </div>
    </div>
  );
}
