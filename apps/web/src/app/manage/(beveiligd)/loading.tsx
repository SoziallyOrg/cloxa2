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

/** Vandaag while it loads: the title, the numbers row and the timeline rows. */
export default function TodayLoading() {
  return (
    <div role="status" className="flex flex-col pb-10">
      <span className="sr-only">{t("ui.loadingContent")}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <SkeletonTitle />
        <Skeleton className="-mt-2 ml-gutter h-4 w-44" />
      </div>
      <div
        aria-hidden="true"
        className="flex flex-col gap-8 px-gutter pt-4 md:px-gutter-desktop"
      >
        <div className="grid grid-cols-2 md:grid-cols-4">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className="flex flex-col gap-2 py-3">
              <Skeleton className="h-8 w-10" />
              <Skeleton className="h-3.5 w-24" />
            </div>
          ))}
        </div>
        <ul className="overflow-hidden rounded-list bg-surface md:rounded-none md:bg-transparent">
          {BARS.map((bar, row) => (
            <li
              key={row}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3.5 pr-4 pl-4 md:grid-cols-[minmax(11rem,15rem)_minmax(0,1fr)_6.5rem] md:items-center md:gap-x-8 md:px-0"
            >
              <span className="flex flex-col gap-2">
                <Skeleton className={`h-4 ${NAME_WIDTHS[row]}`} />
                <Skeleton className="h-3 w-20" />
              </span>
              <span className="col-span-2 row-start-2 block h-2 rounded-full bg-track md:col-span-1 md:col-start-2 md:row-start-1 md:h-6 md:rounded-md md:bg-fill">
                <Skeleton className={`h-full rounded-[inherit] ${bar}`} />
              </span>
              <Skeleton className="col-start-2 row-start-1 h-4 w-14 justify-self-end md:col-start-3" />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
