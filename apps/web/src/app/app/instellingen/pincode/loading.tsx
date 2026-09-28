import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Kiosk-pincode while it loads: the intro and the two fields. */
export default function PinLoading() {
  return (
    <div className="flex flex-col gap-8 pb-10">
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-inset">
        <div aria-hidden="true" className="flex flex-col gap-2 px-4">
          <Skeleton className="h-3.5 w-4/5" />
          <Skeleton className="h-3.5 w-3/5" />
        </div>
        <SkeletonList rows={2} value />
      </div>
    </div>
  );
}
