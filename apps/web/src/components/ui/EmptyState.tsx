import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** A Lucide icon for what is missing; an inbox by default. */
  icon?: LucideIcon;
  title: string;
  /** One friendly sentence: what will appear here, or what to do. */
  body?: string;
  /** At most one action, e.g. a "Nieuwe vraag" button. */
  action?: ReactNode;
}

/** A calm placeholder for lists with nothing in them yet — never an error. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  body,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Icon aria-hidden="true" className="mb-3 size-10 text-ink-2" strokeWidth={1.25} />
      <p className="text-body font-semibold">{title}</p>
      {body ? <p className="max-w-sm text-body text-ink-2">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
