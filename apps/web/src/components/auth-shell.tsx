import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { nlBE } from "@/i18n/nl-BE";

export function AuthShell({
  children,
  description,
  icon: Icon,
  title,
}: {
  children: ReactNode;
  description: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <main
      className="mx-auto flex w-full max-w-6xl flex-1 items-center px-4 py-12 sm:px-6 sm:py-20 lg:px-8"
      id="main-content"
    >
      <section className="docket-surface grid w-full overflow-hidden rounded-2xl border border-rule-strong lg:grid-cols-[minmax(0,0.72fr)_minmax(22rem,1.28fr)]">
        <div className="flex min-h-44 flex-col justify-between bg-primary p-6 text-primary-foreground sm:p-8 lg:min-h-[30rem]">
          <Icon aria-hidden="true" className="size-8" strokeWidth={1.8} />
          <p className="max-w-sm text-sm leading-6 text-[color:var(--color-primary-foreground-muted)]">
            {nlBE.brand.descriptor}
          </p>
        </div>
        <div className="flex flex-col justify-center bg-paper/94 p-6 sm:p-10 lg:p-14">
          <h1 className="max-w-xl font-display text-4xl leading-[1.02] font-semibold tracking-[-0.03em] text-balance text-ink sm:text-5xl">
            {title}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
            {description}
          </p>
          <div className="mt-8 border-t border-rule pt-6">{children}</div>
        </div>
      </section>
    </main>
  );
}
