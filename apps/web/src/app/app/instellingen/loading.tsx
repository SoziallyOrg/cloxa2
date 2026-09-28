import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Instellingen while it loads: the three groups, with their icons. */
export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-8 pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-inset">
        <SkeletonList rows={1} icon value />
        <SkeletonList rows={1} icon subtitle />
        <SkeletonList rows={2} icon />
      </div>
    </div>
  );
}
