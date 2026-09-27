import { t } from "@cloxa/i18n";

import { EmptyState } from "../ui/EmptyState";
import { StatusBadge, type StatusTone } from "../ui/StatusBadge";

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
}

export interface TodayBoardAttentionItem {
  readonly id: string;
  readonly name: string;
  readonly reason: string;
}

export interface TodayBoardProps {
  counters: TodayBoardCounters;
  people: readonly TodayBoardPerson[];
  attention: readonly TodayBoardAttentionItem[];
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-4">
      <span className="text-3xl font-bold">{value}</span>
      <span className="text-base text-ink/70">{label}</span>
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
          <p className="text-lg text-ink/70">{t("manage.noAttention")}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {attention.map((item) => (
              <li
                key={item.id}
                className="flex flex-col gap-3 rounded-md bg-status-break-bg p-4 text-status-break sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex flex-col gap-1">
                  <span className="font-semibold">{item.name}</span>
                  <span>{item.reason}</span>
                </div>
                <a
                  href="#"
                  className="focus-ring inline-flex min-h-touch-target items-center justify-center rounded-md border-2 border-status-break px-6 text-lg font-semibold text-status-break"
                >
                  {t("manage.viewAction")}
                </a>
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
                <tr className="border-b border-border text-ink/70">
                  <th className="py-2 font-semibold">{t("manage.nameColumn")}</th>
                  <th className="py-2 font-semibold">{t("manage.statusColumn")}</th>
                  <th className="py-2 font-semibold">{t("manage.timesColumn")}</th>
                </tr>
              </thead>
              <tbody>
                {people.map((person) => (
                  <tr key={person.id} className="border-b border-border">
                    <td className="py-3 font-semibold">{person.name}</td>
                    <td className="py-3">
                      <StatusBadge tone={person.tone} label={person.statusLabel} />
                    </td>
                    <td className="py-3 text-ink/70">{person.sinceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Cards on mobile. */}
            <ul className="flex flex-col gap-3 md:hidden">
              {people.map((person) => (
                <li
                  key={person.id}
                  className="flex flex-col gap-2 rounded-lg border border-border p-4"
                >
                  <span className="font-semibold">{person.name}</span>
                  <StatusBadge tone={person.tone} label={person.statusLabel} />
                  {person.sinceLabel ? (
                    <span className="text-ink/70">{person.sinceLabel}</span>
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
