"use client";

import { queuedCountFor } from "@/lib/offline/browser";

import { SessionRows } from "../auth/SessionActions";

/** Instellingen's sign-out rows, warning when actions are still queued here. */
export function SettingsSessionRows({ employeeId }: { employeeId: string }) {
  return <SessionRows queuedCount={() => queuedCountFor(employeeId)} />;
}
