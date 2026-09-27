"use client";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { WorkspaceClock } from "@/lib/time-clock/workspace-clock";
import { readWorkStatus } from "@/lib/time-clock/read-work-status";
import { submitTimeClockAction } from "@/lib/time-clock/actions";

const ClockContext = createContext<WorkspaceClock | null>(null);
export function EmployeeClockProvider({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const [clock] = useState(
    () =>
      new WorkspaceClock(scope, {
        read: readWorkStatus,
        submit: submitTimeClockAction,
      }),
  );
  const path = usePathname();
  useLayoutEffect(() => clock.setScope(scope), [clock, scope]);
  useEffect(() => {
    clock.start();
    const refresh = () => {
      void clock.refresh(true);
    };
    const clear = () => clock.clear();
    const logout = () => clock.clear(true);
    const visibility = () =>
      document.visibilityState === "hidden" ? clear() : refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("pageshow", refresh);
    window.addEventListener("pagehide", clear);
    window.addEventListener("cloxa:signing-out", logout);
    window.addEventListener("cloxa:clock-changed", refresh);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      clock.stop();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("pagehide", clear);
      window.removeEventListener("cloxa:signing-out", logout);
      window.removeEventListener("cloxa:clock-changed", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clock]);
  useEffect(() => {
    void clock.refresh();
  }, [clock, path]);
  return <ClockContext.Provider value={clock}>{children}</ClockContext.Provider>;
}

// A cached layout identity is not authority. Each RoleShell supplies freshly guarded
// page identity; on mismatch hide descendants before adopting the new scope.
export function EmployeeClockScope({
  scope,
  children,
}: {
  scope: string;
  children: ReactNode;
}) {
  const clock = useContext(ClockContext);
  if (!clock) throw new Error("Employee clock layout missing");
  const state = useSyncExternalStore(
    clock.subscribe,
    clock.getSnapshot,
    clock.getSnapshot,
  );
  useLayoutEffect(() => clock.setScope(scope), [clock, scope]);
  return state.scope === scope ? children : null;
}
export function useEmployeeClock() {
  const clock = useContext(ClockContext);
  if (!clock) throw new Error("Employee clock layout missing");
  return {
    clock,
    state: useSyncExternalStore(clock.subscribe, clock.getSnapshot, clock.getSnapshot),
  };
}
