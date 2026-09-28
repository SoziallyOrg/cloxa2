import type { ReactNode } from "react";

export interface EmptyStateProps {
  title: string;
  body: string;
  action?: ReactNode;
}

/** A calm placeholder for lists with nothing in them yet — never an error. */
export function EmptyState({ title, body, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-group bg-fill px-6 py-10 text-center">
      <p className="text-headline">{title}</p>
      <p className="max-w-sm text-body text-ink-2">{body}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
