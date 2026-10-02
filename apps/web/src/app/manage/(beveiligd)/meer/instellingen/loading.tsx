import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Instellingen while it loads: one setting per group. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter md:px-gutter-desktop">
        <SkeletonList rows={1} value />
        <SkeletonList rows={1} value />
        <SkeletonList rows={1} value />
        <SkeletonList rows={1} value />
      </div>
    </div>
  );
}
