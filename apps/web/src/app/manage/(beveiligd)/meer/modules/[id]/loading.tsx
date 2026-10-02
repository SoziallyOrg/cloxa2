import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** A module's page while it loads: the switch, the explanation, the settings. */
export default function ModuleDetailLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter md:px-gutter-desktop">
        <SkeletonList rows={1} />
        <SkeletonList rows={1} subtitle />
        <SkeletonList rows={2} value />
      </div>
    </div>
  );
}
