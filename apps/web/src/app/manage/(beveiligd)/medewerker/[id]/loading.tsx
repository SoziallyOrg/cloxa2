import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** An employee while it loads: name and details, the 14 days, the schedule. */
export default function EmployeeLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter">
        <div aria-hidden="true" className="-mt-2 flex flex-col gap-3 px-4">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-4 w-24" />
        </div>
        <SkeletonList rows={6} header subtitle value />
        <SkeletonList rows={4} header value />
      </div>
    </div>
  );
}
