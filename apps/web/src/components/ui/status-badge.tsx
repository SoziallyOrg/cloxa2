import type { ReactNode } from "react";

export const statusTones = {
  approved: "success",
  success: "success",
  pending: "attention",
  rejected: "error",
  error: "error",
  corrected: "info",
  information: "info",
  withdrawn: "neutral",
  neutral: "neutral",
} as const;
export function StatusBadge({
  status,
  children,
}: {
  status: keyof typeof statusTones;
  children: ReactNode;
}) {
  return (
    <span className="status-badge" data-tone={statusTones[status]}>
      {children}
    </span>
  );
}
