import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Meer while it loads: three soft groups of links. */
export default function MoreLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter md:px-gutter-desktop">
        <SkeletonList rows={4} icon />
        <SkeletonList rows={2} icon />
        <SkeletonList rows={2} icon />
      </div>
    </div>
  );
}
