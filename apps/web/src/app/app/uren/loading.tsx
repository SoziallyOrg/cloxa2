import { Skeleton, SkeletonTitle } from "@/components/ui/Skeleton";
import { t } from "@cloxa/i18n";

/** Mijn uren while it loads: the week switcher, the week total, then the days. */
export default function HoursLoading() {
  return (
    <div role="status" className="flex flex-col gap-7 pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <SkeletonTitle />
      <div
        aria-hidden="true"
        className="flex flex-col gap-7 px-gutter md:px-gutter-desktop"
      >
        <Skeleton className="h-14 w-full rounded-[14px] lg:max-w-md" />
        <div className="flex items-end justify-between rounded-card bg-card p-5 shadow-card">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-8 w-28" />
          </div>
          <Skeleton className="h-6 w-20 rounded-control" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, row) => (
            <div
              key={row}
              className="flex flex-col gap-3 rounded-control bg-card px-4 py-3 shadow-card"
            >
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-4 w-14" />
              </div>
              <Skeleton className="h-2.5 w-full rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
