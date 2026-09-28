import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Mijn uren while it loads: the week total, then the days. */
export default function HoursLoading() {
  return (
    <div className="flex flex-col gap-8 pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-inset">
        <div
          aria-hidden="true"
          className="flex flex-col gap-2 rounded-list bg-surface px-4 py-4"
        >
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-3.5 w-16" />
        </div>
        <SkeletonList rows={7} header subtitle value />
      </div>
    </div>
  );
}
