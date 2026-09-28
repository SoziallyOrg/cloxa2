import { SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** The activity log while it loads: the check, then a day of entries. */
export default function AuditLoading() {
  return (
    <div className="flex flex-col pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter">
        <SkeletonList rows={1} icon />
        <SkeletonList rows={6} header subtitle />
      </div>
    </div>
  );
}
