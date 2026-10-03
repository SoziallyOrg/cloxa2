import { t } from "@cloxa/i18n";

import { Skeleton, SkeletonTitle } from "@/components/ui/Skeleton";

const NAME_WIDTHS = ["w-32", "w-28", "w-36", "w-24", "w-32", "w-28"];
const BARS = [
  "ml-[10%] w-[30%]",
  "ml-[14%] w-[22%]",
  "ml-[20%] w-[18%]",
  "ml-0 w-0",
  "ml-[44%] w-[40%]",
  "ml-[12%] w-[26%]",
];

/** Vandaag while it loads: the title, four status blocks and the timeline card. */
export default function TodayLoading() {
  return (
    <div role="status" className="flex flex-col pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonTitle />
        <Skeleton className="-mt-2 ml-gutter h-4 w-44 md:ml-gutter-desktop" />
      </div>
      <div
        aria-hidden="true"
        className="@container flex flex-col gap-5 px-gutter pt-4 md:px-gutter-desktop"
      >
        <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
          {[0, 1, 2, 3].map((cell) => (
            <Skeleton key={cell} className="h-14 rounded-card" />
          ))}
        </div>
        <ul className="flex flex-col gap-1 rounded-card bg-card p-5 shadow-card">
          {BARS.map((bar, row) => (
            <li
              key={row}
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 py-2.5 @xl:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)_minmax(6.5rem,9rem)]"
            >
              <Skeleton className={`h-4 ${NAME_WIDTHS[row]}`} />
              <span className="col-span-2 row-start-2 block h-2 rounded-full bg-track @xl:col-span-1 @xl:col-start-2 @xl:row-start-1 @xl:h-6 @xl:rounded-md">
                <Skeleton className={`h-full rounded-[inherit] ${bar}`} />
              </span>
              <Skeleton className="col-start-2 row-start-1 h-4 w-14 justify-self-end @xl:col-start-3" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
