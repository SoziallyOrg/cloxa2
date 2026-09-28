import type { ReactNode } from "react";

import type { Shift, ShiftState } from "@cloxa/domain";
import { t } from "@cloxa/i18n";

import { BottomNav, type BottomNavItem } from "../ui/BottomNav";
import { Heading } from "../ui/Heading";
import { IconChat, IconClock, IconList } from "../ui/icons";
import { ClockActions, type ClockActionCallback } from "../clock/ClockActions";
import { ClockStatus } from "../clock/ClockStatus";
import { ShiftList } from "../clock/ShiftList";

export type EmployeeHomeNav = "clock" | "hours" | "questions";

export interface EmployeeHomeProps {
  firstName: string;
  shiftState: ShiftState;
  since: number | null;
  now: number;
  todayShifts: readonly Shift[];
  activeNav: EmployeeHomeNav;
  onStartWork: ClockActionCallback;
  onStopWork: ClockActionCallback;
  onStartBreak: ClockActionCallback;
  onStopBreak: ClockActionCallback;
  /** Session actions (afmelden / overal afmelden), rendered in the menu disclosure. */
  menu?: ReactNode;
  /** Above the clock status: an offline banner or an error alert, if any. */
  notice?: ReactNode;
  /** Disables the clock buttons, e.g. while offline. */
  actionsDisabled?: boolean;
}

/**
 * The employee's whole screen: header, status, actions, today's summary and
 * navigation. Works from 320px wide with no horizontal scroll — one column,
 * no fixed pixel widths beyond the touch targets.
 */
export function EmployeeHome({
  firstName,
  shiftState,
  since,
  now,
  todayShifts,
  activeNav,
  onStartWork,
  onStopWork,
  onStartBreak,
  onStopBreak,
  menu,
  notice,
  actionsDisabled = false,
}: EmployeeHomeProps) {
  const navItems: BottomNavItem[] = [
    {
      key: "clock",
      label: t("bottomNav.clock"),
      href: "/app",
      icon: <IconClock />,
      current: activeNav === "clock",
    },
    {
      key: "hours",
      label: t("bottomNav.hours"),
      href: "/app/uren",
      icon: <IconList />,
      current: activeNav === "hours",
    },
    {
      key: "questions",
      label: t("bottomNav.questions"),
      href: "/app/vragen",
      icon: <IconChat />,
      current: activeNav === "questions",
    },
  ];

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-xl flex-col">
      <h1 className="sr-only">{t("app.heading")}</h1>
      <header className="flex items-center justify-between gap-3 p-4">
        <img
          src="/branding/cloxa-compact.svg"
          alt={t("common.appName")}
          className="h-8 w-auto"
        />
        <p className="truncate text-lg font-semibold">
          {t("common.greeting", { name: firstName })}
        </p>
        <details className="relative">
          <summary className="focus-ring min-h-touch-target cursor-pointer list-none rounded-md border border-border px-3 py-2 text-center font-semibold">
            {t("common.menu")}
          </summary>
          {menu ? (
            <div className="absolute right-0 z-10 mt-2 w-64 rounded-lg border border-border bg-surface p-4 shadow-none">
              {menu}
            </div>
          ) : null}
        </details>
      </header>

      <main className="flex flex-1 flex-col gap-10 px-4 pb-28">
        {notice}
        <ClockStatus state={shiftState} since={since} now={now} />

        <ClockActions
          state={shiftState}
          onStartWork={onStartWork}
          onStopWork={onStopWork}
          onStartBreak={onStartBreak}
          onStopBreak={onStopBreak}
          disabled={actionsDisabled}
        />

        <section className="flex flex-col gap-4">
          <Heading level={2}>{t("employeeHome.todayHeading")}</Heading>
          <ShiftList shifts={todayShifts} />
        </section>
      </main>

      <div className="fixed inset-x-0 bottom-0 mx-auto w-full max-w-xl">
        <BottomNav items={navItems} />
      </div>
    </div>
  );
}
