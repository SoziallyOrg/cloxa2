import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Team while it loads: the segments, the search field and the people. */
export default function TeamLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-6 px-gutter">
        <div aria-hidden="true" className="flex flex-col gap-6">
          <Skeleton className="h-touch-target w-full rounded-[10px]" />
          <Skeleton className="h-touch-target w-full rounded-control" />
        </div>
        <SkeletonList rows={8} subtitle value />
      </div>
    </div>
  );
}
