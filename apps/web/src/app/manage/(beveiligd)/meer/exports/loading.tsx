import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Exports while they load: the period, the sites and the earlier exports. */
export default function ExportsLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter md:px-gutter-desktop">
        <div aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-touch-target w-full rounded-[10px]" />
          <Skeleton className="h-row w-full rounded-list" />
        </div>
        <SkeletonList rows={2} />
        <SkeletonList rows={3} header subtitle />
      </div>
    </div>
  );
}
