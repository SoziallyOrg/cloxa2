import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** The correction wizard while it loads: the step dots and three choices. */
export default function NewQuestionLoading() {
  return (
    <div className="flex flex-col gap-8 pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter">
        <div aria-hidden="true" className="flex items-center gap-3 px-4">
          <Skeleton className="h-2 w-10" />
          <Skeleton className="h-3.5 w-20" />
        </div>
        <SkeletonList rows={3} />
      </div>
    </div>
  );
}
