import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { LogoutForm } from "@/components/logout-form";

export function RoleShell({
  description,
  icon: Icon,
  status,
  title,
  children,
}: {
  children?: ReactNode;
  description: string;
  icon: LucideIcon;
  status: string;
  title: string;
}) {
  return (
    <main
      className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6 sm:py-16 lg:px-8"
      id="main-content"
    >
      <div className="flex items-center justify-between gap-4 border-b border-rule pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <Icon aria-hidden="true" className="size-6 text-primary" />
          <h1 className="truncate font-display text-3xl font-semibold tracking-[-0.025em] text-ink sm:text-4xl">
            {title}
          </h1>
        </div>
        <span className="shrink-0 rounded-full border border-rule-strong bg-signal-soft px-3 py-1 text-xs font-semibold text-signal-ink">
          {status}
        </span>
      </div>

      <div className="mt-5 flex justify-end">
        <LogoutForm />
      </div>

      <section className="docket-surface mt-8 min-h-72 rounded-2xl border border-rule-strong p-6 sm:p-10">
        <p className="max-w-2xl text-lg leading-8 text-muted">{description}</p>
        {children}
      </section>
    </main>
  );
}
