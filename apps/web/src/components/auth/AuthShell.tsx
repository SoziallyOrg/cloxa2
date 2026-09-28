import type { ReactNode } from "react";

import { Logo } from "@/components/brand/Logo";
import { cx } from "@/components/ui/cx";

export interface AuthShellProps {
  title: string;
  /** One short line under the title, if the screen needs it. */
  intro?: ReactNode;
  /** `grouped` when the screen holds an inset grouped list (kies-organisatie). */
  tone?: "plain" | "grouped";
  children: ReactNode;
}

/**
 * Centred and narrow: the logotype, a large title, then one field and one
 * button. Clears the notch and home indicator when opened full screen.
 */
export function AuthShell({ title, intro, tone = "plain", children }: AuthShellProps) {
  return (
    <main
      className={cx(
        "flex min-h-dvh flex-col items-center px-gutter pt-[max(3rem,calc(env(safe-area-inset-top)+1.5rem))] pb-[max(3rem,env(safe-area-inset-bottom))] md:justify-center md:py-16",
        tone === "grouped" ? "bg-grouped" : "bg-paper",
      )}
    >
      <div className="flex w-full max-w-sm flex-1 flex-col gap-10 md:flex-none">
        <Logo size="lg" />
        <div className="flex flex-col gap-3">
          <h1 className="text-large-title break-words">{title}</h1>
          {intro}
        </div>
        {children}
      </div>
    </main>
  );
}
