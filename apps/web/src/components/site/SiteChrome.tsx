import Link from "next/link";
import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { Logo } from "@/components/brand/Logo";
import { buttonClassName } from "@/components/ui/Button";

/** The width and gutters every public page shares. */
export const SITE_WIDTH = "mx-auto w-full max-w-5xl px-gutter md:px-10";

/**
 * Header, footer and the skip link of the public pages (landing, request
 * form, legal texts). The app itself (`/app`, `/manage`, `/kiosk`) has its own
 * frames; nothing here ships to it.
 */
export function SiteChrome({
  children,
  hero,
}: {
  children: ReactNode;
  hero?: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <a
        href="#inhoud"
        className="focus-ring sr-only rounded-control bg-paper px-4 py-3 focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-20"
      >
        {t("landing.skipToContent")}
      </a>
      <div className="on-forest relative overflow-hidden rounded-b-hero bg-forest text-white">
        <header className={`${SITE_WIDTH} flex items-center justify-between py-5`}>
          <Link href="/" className="focus-ring on-forest rounded-control">
            <Logo size="sm" tone="on-forest" />
          </Link>
          <nav aria-label={t("landing.headerNav")}>
            <Link href="/login" className={buttonClassName("ghost-on-forest", "sm")}>
              {t("landing.login")}
            </Link>
          </nav>
        </header>
        {hero}
      </div>
      <main id="inhoud" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

const LINK =
  "focus-ring inline-flex min-h-touch-target items-center rounded-control px-1";

function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line">
      <div
        className={`${SITE_WIDTH} flex flex-col gap-4 py-8 text-subhead text-ink-2 md:flex-row md:items-center md:justify-between`}
      >
        <nav aria-label={t("landing.footer.nav")}>
          <ul className="flex flex-wrap gap-x-6 gap-y-1">
            <li>
              <Link href="/privacy" className={LINK}>
                {t("landing.footer.privacy")}
              </Link>
            </li>
            <li>
              <Link href="/voorwaarden" className={LINK}>
                {t("landing.footer.terms")}
              </Link>
            </li>
            <li>
              <Link href="/verwerkersovereenkomst" className={LINK}>
                {t("landing.footer.dpa")}
              </Link>
            </li>
            <li>
              <Link href="/privacy#contact" className={LINK}>
                {t("landing.footer.contact")}
              </Link>
            </li>
          </ul>
        </nav>
        <p>{t("landing.footer.copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
