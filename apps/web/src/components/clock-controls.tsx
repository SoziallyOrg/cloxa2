"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useEmployeeClock } from "./employee-clock-provider";
import { Button } from "./ui/button";
import { StatusBadge } from "./ui/status-badge";
import { workStatusLabel } from "@/lib/time-clock/work-status";
import type { ClockIntent } from "@/lib/time-clock/workspace-clock";
import { nlBE } from "@/i18n/nl-BE";

const labels: Record<ClockIntent, string> = {
  clock_in: "Start werk",
  clock_out: "Stop werk",
  start_break: "Start pauze",
  end_break: "Pauze beëindigen",
};
export function ClockControls({ location }: { location: "header" | "panel" }) {
  const { clock, state } = useEmployeeClock();
  const path = usePathname();
  const feedbackOwner = path === "/employee" ? state.feedbackOwner : "header";
  const intents: ClockIntent[] = state.retry
    ? [state.retry]
    : state.clock?.status === "working"
      ? ["start_break", "clock_out"]
      : state.clock?.status === "on_break"
        ? ["end_break"]
        : state.clock?.status === "not_working"
          ? ["clock_in"]
          : [];
  return (
    <div
      className={`clock-controls clock-controls-${location}`}
      aria-label={location === "header" ? "Snelle klokbediening" : "Tijdklokbediening"}
    >
      <div className="clock-buttons" aria-busy={state.pending}>
        {intents.map((intent) => (
          <Button
            key={intent}
            type="button"
            variant={location === "header" ? "secondary" : "primary"}
            disabled={!clock.canSubmit(intent)}
            onClick={() => {
              void clock.submit(intent, location);
            }}
          >
            {state.pending &&
            state.pendingIntent === intent &&
            state.feedbackOwner === location
              ? `${labels[intent]} — bezig…`
              : state.retry
                ? `Opnieuw: ${labels[intent]}`
                : labels[intent]}
          </Button>
        ))}
        {!state.clock && (
          <Button
            type="button"
            variant="quiet"
            disabled={state.pending || state.refreshing || state.signedOut}
            onClick={() => void clock.refresh(true)}
          >
            {state.pending
              ? `${labels[state.pendingIntent!]} — bezig…`
              : state.refreshing
                ? "Controleren…"
                : "Werkstatus controleren"}
          </Button>
        )}
      </div>
      {state.clock?.status === "on_break" && location === "panel" && (
        <p className="mt-2 text-sm">{nlBE.breaks.interlock}</p>
      )}
      {state.feedback.message && feedbackOwner === location && (
        <ClockFeedback key={`${path}:${state.feedbackVersion}`} />
      )}
    </div>
  );
}
function ClockFeedback() {
  const { clock, state } = useEmployeeClock();
  const feedback = useRef<HTMLParagraphElement>(null);
  const [announce] = useState(() => !clock.feedbackWasPresented(state.feedbackVersion));
  useLayoutEffect(() => {
    if (clock.markFeedbackPresented(state.feedbackVersion)) feedback.current?.focus();
  }, [clock, state.feedbackVersion]);
  return (
    <p
      ref={feedback}
      tabIndex={-1}
      role={
        announce ? (state.feedback.status === "error" ? "alert" : "status") : undefined
      }
      className="clock-feedback"
    >
      {state.feedback.message}
    </p>
  );
}
export function WorkIndicator() {
  const { state } = useEmployeeClock();
  return (
    <div className="workspace-work-status" aria-label="Huidige werkstatus">
      <StatusBadge
        status={
          !state.clock
            ? "neutral"
            : state.clock.status === "on_break"
              ? "pending"
              : state.clock.status === "working"
                ? "information"
                : "neutral"
        }
      >
        {workStatusLabel(state.clock, state.phase === "loading")}
      </StatusBadge>
      <ClockControls location="header" />
    </div>
  );
}
