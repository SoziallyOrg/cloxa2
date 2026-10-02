import { t } from "@cloxa/i18n";

import { Skeleton, SkeletonList, SkeletonTitle } from "@/components/ui/Skeleton";

/** Instellingen while it loads: the profile card and the groups, with their icons. */
export default function SettingsLoading() {
  return (
    <div role="status" className="flex flex-col gap-8 pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <SkeletonTitle />
      <div className="flex flex-col gap-8 px-gutter md:px-gutter-desktop lg:max-w-readable">
        <div
          aria-hidden="true"
          className="flex items-center gap-4 rounded-card bg-card p-4 shadow-card"
        >
          <Skeleton className="size-14 rounded-clock" />
          <Skeleton className="h-6 w-40" />
        </div>
        <SkeletonList rows={1} icon value />
        <SkeletonList rows={1} icon subtitle />
        <SkeletonList rows={2} icon />
      </div>
    </div>
  );
}
