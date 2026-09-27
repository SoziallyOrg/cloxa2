"use client";

import { Clock3 } from "lucide-react";
import { useEffect } from "react";
import { ClockControls } from "./clock-controls";
import { useEmployeeClock } from "./employee-clock-provider";
import { RegistrationRecord } from "./registration-record";
import type { Provenance } from "@/lib/corrections/provenance";
import { Button } from "./ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { formatBelgianDate } from "@/lib/time-clock/format";
import { workStatusLabel } from "@/lib/time-clock/work-status";
import type { TimeClockView } from "@/lib/time-clock/model";

export function TimeClockPanel({
  clock,
  provenance = null,
}: {
  clock: TimeClockView | null;
  provenance?: Provenance | null;
}) {
  const live = useEmployeeClock();
  // Page snapshots are factual history only; never seed live controls from a stale RSC.
  useEffect(() => {
    void live.clock.refresh();
  }, [live.clock, clock]);
  if (!clock)
    return (
      <div className="mt-8 rounded-surface border border-danger/40 bg-paper p-6">
        <p className="font-semibold text-danger" role="alert">
          {nlBE.timeClock.loadFailure}
        </p>
        <Button asChild className="mt-5" variant="secondary">
          <a href="/employee">{nlBE.timeClock.retry}</a>
        </Button>
      </div>
    );
  return (
    <div className="time-clock-workspace">
      <section className="clock-panel" aria-labelledby="time-clock-title">
        <div className="flex items-start gap-3">
          <Clock3 size={22} className="mt-1 shrink-0 text-primary" aria-hidden="true" />
          <h2 id="time-clock-title" className="font-display text-3xl font-semibold">
            {workStatusLabel(live.state.clock, live.state.phase === "loading")}
          </h2>
        </div>
        <ClockControls location="panel" />
        <p className="mt-4 text-sm text-muted">{nlBE.breaks.help}</p>
      </section>
      <section aria-labelledby="today-title" className="min-w-0">
        {provenance === null && (
          <p className="mb-3 text-sm text-muted">
            Correctiegegevens niet beschikbaar. Registraties blijven zichtbaar.
          </p>
        )}
        <div className="flex items-end justify-between gap-4 border-b border-rule-strong pb-3">
          <div>
            <h2 className="font-display text-3xl font-semibold" id="today-title">
              {nlBE.timeClock.today}
            </h2>
            <p className="mt-1 text-sm font-semibold text-muted capitalize">
              {formatBelgianDate(clock.serverTime)}
            </p>
          </div>
          <span className="font-display text-2xl font-semibold text-primary">
            {clock.entries.length}
          </span>
        </div>
        {clock.entries.length === 0 ? (
          <p className="py-8 text-base text-muted">{nlBE.timeClock.empty}</p>
        ) : (
          <ol className="divide-y divide-rule" data-testid="today-entries">
            {clock.entries.map((entry) => (
              <li key={entry.id}>
                <RegistrationRecord entry={entry} provenance={provenance?.[entry.id]} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
