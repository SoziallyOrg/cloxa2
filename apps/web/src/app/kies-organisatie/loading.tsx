import { Skeleton, SkeletonList } from "@/components/ui/Skeleton";

/** Kies je organisatie while it loads: the title and the organizations. */
export default function ChooseOrganizationLoading() {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-grouped px-gutter pt-12 md:justify-center md:py-16">
      <div className="flex w-full max-w-sm flex-col gap-10">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-9 w-4/5 rounded-lg" />
        <SkeletonList rows={2} icon />
      </div>
    </main>
  );
}
