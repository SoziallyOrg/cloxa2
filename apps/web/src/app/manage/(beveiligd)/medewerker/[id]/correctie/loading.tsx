import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** The correction wizard while it loads: title, step bars, three choices. */
export default function ManagerCorrectionLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-6 px-gutter md:px-gutter-desktop">
        <div aria-hidden="true" className="px-1">
          <Skeleton className="h-3 w-48" />
        </div>
        <SkeletonList rows={3} header />
      </div>
    </div>
  );
}
