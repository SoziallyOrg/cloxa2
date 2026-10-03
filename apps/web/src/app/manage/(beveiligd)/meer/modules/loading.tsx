import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Modules while it loads: one group per module (switch and link), then CIAO. */
export default function ModulesLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter md:px-gutter-desktop">
        <SkeletonList rows={2} subtitle />
        <SkeletonList rows={2} subtitle />
        <SkeletonList rows={2} subtitle />
        <SkeletonList rows={2} subtitle />
        <SkeletonList rows={2} subtitle />
        <SkeletonList rows={1} subtitle />
      </div>
    </div>
  );
}
