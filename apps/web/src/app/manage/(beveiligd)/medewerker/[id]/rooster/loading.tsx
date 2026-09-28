import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** The schedule editor while it loads: the weekly total and the first days. */
export default function ScheduleLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter">
        <div aria-hidden="true" className="flex flex-col gap-2 px-4">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-28" />
        </div>
        <SkeletonList rows={2} header />
        <SkeletonList rows={2} header />
        <SkeletonList rows={2} header />
      </div>
    </div>
  );
}
