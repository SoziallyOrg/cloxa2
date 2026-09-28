import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Kiosks while they load: the tablets, grouped by site. */
export default function KiosksLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter">
        <SkeletonList rows={2} header subtitle value />
        <SkeletonList rows={1} header subtitle value />
      </div>
    </div>
  );
}
