"use client";

import { createContext, use, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

import { t } from "@cloxa/i18n";

import type { ClockBarData } from "@/lib/clock/bar";
import { displayedState } from "@/lib/offline/queue";

import { Alert } from "../ui/Alert";
import { CRing } from "../ui/CRing";
import { cx } from "../ui/cx";
import { clockBarModel } from "./clock-bar";
import { useClockRunner } from "./use-clock-runner";

/** The Klok screen has its own big clock: the bar stays away from it. */
const KLOK_PATH = "/app";

const ClockBarContext = createContext(false);

/**
 * Tells the frame whether a clock bar is (or may be) shown, so it can leave
 * room for it. Stable across navigation: it only carries a boolean.
 */
export function ClockBarProvider({
  data,
  children,
}: {
  data: ClockBarData | null;
  children: ReactNode;
}) {
  return <ClockBarContext value={data !== null}>{children}</ClockBarContext>;
}

/** Empty space the height of the bar, so nothing hides behind it. */
export function ClockBarSpacer({ placement }: { placement: "content" | "sidebar" }) {
  const active = use(ClockBarContext);
  const pathname = usePathname();
  if (!active || pathname === KLOK_PATH) return null;
  return (
    <div
      aria-hidden="true"
      className={cx(
        placement === "content"
          ? "h-28 shrink-0 lg:hidden"
          : "hidden h-52 shrink-0 lg:block",
      )}
    />
  );
}

/**
 * Shown in both areas whenever the person is clocked in and not on Klok.
 * Phone: above the tab bar. Tablet: along the bottom. Desktop: docked at the
 * bottom of the sidebar. One instance, positioned by CSS, so there is one
 * offline queue and one set of idempotency keys.
 */
export function ClockBar({ data }: { data: ClockBarData | null }) {
  const pathname = usePathname();
  if (data === null || pathname === KLOK_PATH) return null;
  return <ClockBarRunner data={data} />;
}

function ClockBarRunner({ data }: { data: ClockBarData }) {
  const { now, online, queue, error, setError, run } = useClockRunner({
    employeeId: data.employeeId,
    siteId: data.siteId,
    initialNow: data.now,
  });
  const [pending, setPending] = useState<"break" | "stop" | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);

  const displayed = displayedState(
    { state: data.state, since: data.since },
    queue.pending,
  );
  const model = clockBarModel({
    state: displayed.state,
    since: displayed.since,
    // A refresh brings a newer server "now"; never show time before it.
    now: Math.max(now, data.now),
    todayShifts: data.openShifts,
    pending: queue.pending,
  });
  if (model === null) return null;

  const onBreak = model.kind === "on_break";
  const disabled = (!online && !queue.supported) || pending !== null;

  async function press(
    kind: "break" | "stop",
    type: "break_start" | "break_end" | "clock_out",
  ) {
    if (pending !== null) return;
    setPending(kind);
    await run(type);
    setPending(null);
  }

  return (
    <section
      aria-label={t("shell.clockBarLabel")}
      className={cx(
        "fixed z-40 flex flex-col gap-3 rounded-clock p-3",
        // Phone: above the tab bar. Tablet: along the bottom, beside the icon sidebar.
        "inset-x-3 bottom-[calc(var(--spacing-tab-bar)+env(safe-area-inset-bottom)+0.5rem)]",
        "md:right-3 md:bottom-3 md:left-[calc(var(--spacing-sidebar-icons)+0.75rem)]",
        // Desktop: in the sidebar, above the account entry.
        "lg:inset-x-auto lg:bottom-20 lg:left-4 lg:w-[calc(var(--spacing-sidebar)-2rem)]",
        onBreak ? "bg-break text-break-ink" : "on-forest bg-forest text-white",
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-stretch">
        <div className="flex items-center gap-3">
          <CRing
            progress={model.progress}
            size={46}
            tone={onBreak ? "on-amber" : "on-forest"}
            running={!onBreak}
          />
          <div className="min-w-0">
            <p
              className={cx(
                "text-footnote font-semibold",
                onBreak ? "text-break-ink" : "text-on-forest-2",
              )}
            >
              {model.title}
            </p>
            <p className="text-title-2 tabular-nums">
              <span aria-hidden="true">{model.time}</span>
              <span className="sr-only">{model.spoken}</span>
            </p>
          </div>
        </div>
        <div className="flex gap-2 lg:flex-col">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void press("break", onBreak ? "break_end" : "break_start")}
            className={cx(
              BUTTON,
              onBreak ? "bg-forest text-white" : "bg-white/14 text-white",
            )}
          >
            {model.secondaryLabel}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setConfirmStop(true)}
            className={cx(
              BUTTON,
              onBreak ? "bg-white text-ink" : "bg-lime text-forest-deep",
            )}
          >
            {model.stopLabel}
          </button>
        </div>
      </div>
      {queue.pending.length > 0 ? (
        <p className="text-footnote font-semibold">{t("shell.clockBarNotSent")}</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-footnote font-semibold">
          {error}{" "}
          <button
            type="button"
            onClick={() => setError(null)}
            className="focus-ring rounded-control underline"
          >
            {t("common.close")}
          </button>
        </p>
      ) : null}
      <Alert
        open={confirmStop}
        onClose={() => setConfirmStop(false)}
        title={t("shell.clockBarStopTitle")}
        message={t("shell.clockBarStopMessage")}
        confirmLabel={t("shell.clockBarStopConfirm")}
        onConfirm={() => void press("stop", "clock_out")}
      />
    </section>
  );
}

const BUTTON =
  "pressable focus-ring min-h-touch-target flex-1 rounded-control px-4 text-callout font-bold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";
