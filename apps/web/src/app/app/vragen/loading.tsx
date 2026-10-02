import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Vragen while it loads: the questions as rows. */
export default function QuestionsLoading() {
  return (
    <div className="flex flex-col gap-2 pb-10">
      <SkeletonTitle />
      <div className="px-gutter md:px-gutter-desktop">
        <SkeletonList rows={3} subtitle value />
      </div>
    </div>
  );
}
