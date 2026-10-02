import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { Logo } from "@/components/brand/Logo";
import { CRing } from "@/components/ui/CRing";
import { cx } from "@/components/ui/cx";

export interface AuthShellProps {
  title: string;
  /** One short line under the title, if the screen needs it. */
  intro?: ReactNode;
  /** `grouped` when the screen holds a list of white cards (kies-organisatie): no extra card around it. */
  tone?: "plain" | "grouped";
  children: ReactNode;
}

/**
 * Phone: the logo, then one white card on paper with a large title, one field
 * and one button. Desktop (>= 1024px): two columns, a forest brand panel with
 * the logo's big "c" ring on the left, the same card on the right. Clears the
 * notch and home indicator when opened full screen.
 */
export function AuthShell({ title, intro, tone = "plain", children }: AuthShellProps) {
  const grouped = tone === "grouped";
  return (
    <main className="min-h-dvh bg-paper lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="on-forest hidden flex-col justify-between bg-forest p-12 text-white lg:flex">
        <Logo size="lg" tone="on-forest" />
        <div className="flex flex-col items-start gap-8">
          <CRing progress={0.72} size={300} running />
          <div className="flex max-w-md flex-col gap-3">
            <p className="text-title-1">{t("login.brandHeading")}</p>
            <p className="text-body text-on-forest-2">{t("login.brandBody")}</p>
          </div>
        </div>
        <span aria-hidden="true" />
      </aside>
      <div className="flex min-h-dvh flex-col items-center px-gutter pt-[max(2rem,calc(env(safe-area-inset-top)+1rem))] pb-[max(2rem,env(safe-area-inset-bottom))] md:justify-center md:py-16">
        <div className="flex w-full max-w-md flex-1 flex-col gap-8 md:flex-none">
          <div className="lg:hidden">
            <Logo size="lg" />
          </div>
          <div
            className={cx(
              "flex flex-col gap-6",
              !grouped && "rounded-hero bg-card p-6 shadow-card md:p-8",
            )}
          >
            <div className="flex flex-col gap-3">
              <h1 className="text-large-title break-words">{title}</h1>
              {intro}
            </div>
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
