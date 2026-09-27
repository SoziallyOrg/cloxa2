import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

/** A calm placeholder for lists with nothing in them yet — never an error. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border p-8 text-center">
      <p className="text-xl font-semibold">{title}</p>
      <p className="text-lg text-ink/70">{body}</p>
      {action ? <div>{action}</div> : null}
    </div>
  );
}
