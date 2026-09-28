import Link from "next/link";
import type { Route } from "next";

import { t } from "@cloxa/i18n";

import { EmptyState } from "../ui/EmptyState";
import { StatusLine, type StatusTone } from "../ui/StatusLine";

export interface TodayBoardCounters {
  readonly working: number;
  readonly onBreak: number;
  readonly notStarted: number;
  readonly deviations: number;
}

export interface TodayBoardPerson {
  readonly id: string;
  readonly name: string;
  readonly tone: StatusTone;
  readonly statusLabel: string;
  /** Already-formatted time, e.g. "sinds 08:02", or `null` when off all day. */
  readonly sinceLabel: string | null;
  /** Today's shift contains an event queued offline and synced later. */
  readonly offline?: boolean;
}

export interface TodayBoardAttentionItem {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
  readonly href: string;
}

export interface TodayBoardProps {
  counters: TodayBoardCounters;
  people: readonly TodayBoardPerson[];
  attention: readonly TodayBoardAttentionItem[];
}

function OfflineBadge() {
  return (
    <span className="rounded-md bg-fill px-2 py-1 text-base font-semibold text-ink-2">
      {t("offline.shiftBadge")}
    </span>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-line bg-paper p-4">
      <span className="text-3xl font-bold">{value}</span>
      <span className="text-base text-ink-2">{label}</span>
    </div>
  );
}

/** The manager's overview of the current day: counters, people, exceptions. */
export function TodayBoard({ counters, people, attention }: TodayBoardProps) {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Counter label={t("manage.counterWorking")} value={counters.working} />
        <Counter label={t("manage.counterBreak")} value={counters.onBreak} />
        <Counter label={t("manage.counterNotStarted")} value={counters.notStarted} />
        <Counter label={t("manage.counterDeviations")} value={counters.deviations} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">{t("manage.attentionHeading")}</h2>
        {attention.length === 0 ? (
          <p className="text-lg text-ink-2">{t("manage.noAttention")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 rounded-md bg-break/10 p-4 text-break sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">{item.name}</span>
                  <span>{item.reason}</span>
                </div>
                <Link
                  href={item.href as Route}
                  className="focus-ring inline-flex min-h-touch-target items-center justify-center rounded-md border-2 border-break px-6 text-lg font-semibold text-break"
                >
                  {t("manage.viewAction")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        {people.length === 0 ? (
          <EmptyState
            title={t("manage.counterNotStarted")}
            body={t("manage.noAttention")}
          />
        ) : (
          <>
            {/* Table on desktop. */}
            <table className="hidden w-full text-left md:table">
              <thead>
                <tr className="border-b border-line text-ink-2">
                  <th className="py-2 font-semibold">{t("manage.nameColumn")}</th>
                  <th className="py-2 font-semibold">{t("manage.statusColumn")}</th>
                  <th className="py-2 font-semibold">{t("manage.timesColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id} className="border-b border-line">
                    <td className="py-3 font-semibold">{person.name}</td>
                    <td className="py-3">
                      <StatusLine
                        size="sm"
                        tone={person.tone}
                        label={person.statusLabel}
                      />
                    </td>
                    <td className="py-3 text-ink-2">
                      {person.sinceLabel}
                      {person.offline ? (
                        <>
                          {" "}
                          <OfflineBadge />
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards on mobile. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {people.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-col gap-2 rounded-lg border border-line p-4"
                >
                  <span className="font-semibold">{person.name}</span>
                  <StatusLine size="sm" tone={person.tone} label={person.statusLabel} />
                  {person.sinceLabel ? (
                    <span className="text-ink-2">{person.sinceLabel}</span>
                  ) : null}
                  {person.offline ? (
                    <span>
                      <OfflineBadge />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
