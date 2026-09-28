import type { ReactNode } from "react";

export type ManageNavKey = "today" | "questions" | "team" | "more";

export interface ManageShellProps {
  active: ManageNavKey;
  pendingQuestionsCount?: number;
  showSwitchToEmployee?: boolean;
  children: ReactNode;
}

/**
 * Transitional: the `(beveiligd)` layout now renders the frame
 * (`ManageFrame`). Pages not yet on `NavBar` keep this padded column until
 * they move; it goes once the last one has.
 */
export function ManageShell({ children }: ManageShellProps) {
  return <div className="px-gutter py-8 pb-10">{children}</div>;
}
