import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";

export interface AuthShellProps {
  title: string;
  /** One short line under the title, if the screen needs it. */
  intro?: ReactNode;
  children: ReactNode;
}

/** Centred and narrow: the logotype, a title, then one field and one button. */
export function AuthShell({ title, intro, children }: AuthShellProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center px-gutter py-12 md:justify-center md:py-16">
      <div className="flex w-full max-w-sm flex-1 flex-col gap-10 md:flex-none">
        <Logo size="lg" />
        <div className="flex flex-col gap-3">
          <h1 className="text-title">{title}</h1>
          {intro}
        </div>
        {children}
      </div>
    </main>
  );
}
