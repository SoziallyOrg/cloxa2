"use client";

import { CheckCircle2, Clock3 } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { submitTimeClockAction } from "@/lib/time-clock/actions";
import {
  formatBelgianDate,
  formatBelgianTime,
  formatDuration,
} from "@/lib/time-clock/format";
import {
  initialTimeClockActionState,
  type TimeClockView,
} from "@/lib/time-clock/model";

export function TimeClockPanel({ clock }: { clock: TimeClockView | null }) {
  const [state, action, pending] = useActionState(
    submitTimeClockAction,
    initialTimeClockActionState,
  );
  const requestIdInput = useRef<HTMLInputElement>(null);
  const ensureRequestId = () => {
    if (requestIdInput.current && !requestIdInput.current.value) {
      requestIdInput.current.value = crypto.randomUUID();
    }
  };
  const working = clock?.status === "working";
  const operation = working ? "clock_out" : "clock_in";

  useEffect(() => {
    if (requestIdInput.current) {
      requestIdInput.current.value = crypto.randomUUID();
    }
  }, [operation]);

  if (!clock) {
    return (
      <div className="mt-8 rounded-2xl border border-danger/40 bg-paper p-6">
        <p className="font-semibold text-danger" role="alert">
          {nlBE.timeClock.loadFailure}
        </p>
        <Button asChild className="mt-5" variant="secondary">
          <a href="/employee">{nlBE.timeClock.retry}</a>
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:gap-10">
      <section
        aria-labelledby="time-clock-title"
        className={`self-start rounded-2xl border p-5 sm:p-7 ${
          working ? "border-primary bg-primary" : "border-rule-strong bg-paper-strong"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className={`grid size-11 place-items-center rounded-full border ${
              working
                ? "border-primary-foreground/50 bg-paper text-primary"
                : "border-rule-strong bg-paper-strong text-muted"
            }`}
          >
            <Clock3 className="size-5" />
          </span>
          <div className="min-w-0">
            <h2
              className={`font-display text-3xl font-semibold tracking-[-0.02em] text-balance ${
                working ? "text-primary-foreground" : "text-ink"
              }`}
              id="time-clock-title"
            >
              {working ? nlBE.timeClock.working : nlBE.timeClock.notWorking}
            </h2>
          </div>
        </div>

        <p
          className={`mt-5 min-h-7 text-base ${
            working ? "text-primary-foreground-muted" : "text-muted"
          }`}
          id="clock-state-description"
        >
          {working && clock.currentStartedAt ? (
            <>
              {nlBE.timeClock.startedAt}{" "}
              <time dateTime={clock.currentStartedAt}>
                {formatBelgianTime(clock.currentStartedAt)}
              </time>
            </>
          ) : (
            formatBelgianDate(clock.serverTime)
          )}
        </p>

        <form
          action={action}
          aria-busy={pending}
          className="mt-6"
          onSubmitCapture={ensureRequestId}
        >
          <input name="operation" type="hidden" value={operation} />
          <input
            defaultValue=""
            key={operation}
            name="request_id"
            ref={requestIdInput}
            type="hidden"
          />
          <Button
            aria-describedby="clock-state-description"
            className="min-h-16 w-full text-lg"
            disabled={pending}
            onClick={ensureRequestId}
            size="large"
            type="submit"
            variant={working ? "secondary" : "primary"}
          >
            {pending
              ? nlBE.timeClock.pending
              : working
                ? nlBE.timeClock.stop
                : nlBE.timeClock.start}
          </Button>
        </form>

        {state.message ? (
          <p
            className={`mt-4 text-sm leading-6 ${
              state.status === "error"
                ? "rounded-xl bg-paper px-3 py-2 text-danger"
                : working
                  ? "text-primary-foreground"
                  : "text-ink"
            }`}
            role={state.status === "error" ? "alert" : "status"}
          >
            {state.message}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="today-title">
        <div className="flex items-end justify-between gap-4 border-b border-rule-strong pb-3">
          <div>
            <p className="text-sm font-semibold text-muted capitalize">
              {formatBelgianDate(clock.serverTime)}
            </p>
            <h2
              className="font-display text-3xl font-semibold tracking-[-0.02em] text-ink"
              id="today-title"
            >
              {nlBE.timeClock.today}
            </h2>
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
              <li className="flex items-center gap-4 py-5" key={entry.id}>
                <CheckCircle2
                  aria-hidden="true"
                  className={`size-5 shrink-0 ${
                    entry.endedAt ? "text-muted" : "text-primary"
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">
                    <time dateTime={entry.startedAt}>
                      {formatBelgianTime(entry.startedAt)}
                    </time>
                    <span aria-hidden="true"> – </span>
                    {entry.endedAt ? (
                      <time dateTime={entry.endedAt}>
                        {formatBelgianTime(entry.endedAt)}
                      </time>
                    ) : (
                      nlBE.timeClock.current
                    )}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {entry.endedAt
                      ? `${nlBE.timeClock.completed} · ${nlBE.timeClock.duration} ${formatDuration(entry.startedAt, entry.endedAt)}`
                      : nlBE.timeClock.working}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
