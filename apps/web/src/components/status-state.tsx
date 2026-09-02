import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export function StatusState({
  action,
  announcement,
  description,
  icon: Icon,
  live = false,
  title,
}: {
  action?: ReactNode;
  announcement?: "alert" | "status";
  description: string;
  icon: LucideIcon;
  live?: boolean;
  title: string;
}) {
  return (
    <main
      aria-live={
        announcement === "alert"
          ? "assertive"
          : announcement === "status" || live
            ? "polite"
            : undefined
      }
      className="mx-auto flex w-full max-w-3xl flex-1 items-center px-4 py-16 sm:px-6 lg:px-8"
      id="main-content"
      role={announcement ?? (live ? "status" : undefined)}
    >
      <section className="w-full rounded-2xl border border-rule-strong bg-paper p-6 sm:p-10">
        <Icon
          aria-hidden="true"
          className={cn("size-9 text-primary", live && "motion-safe:animate-spin")}
          strokeWidth={1.8}
        />
        <h1 className="mt-8 font-display text-4xl leading-tight font-semibold tracking-[-0.03em] text-balance text-ink sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
          {description}
        </p>
        {action ? <div className="mt-8 flex flex-wrap gap-3">{action}</div> : null}
      </section>
    </main>
  );
}
