import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/brand-mark";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { getAuthContext } from "@/lib/auth/session";

export async function SiteHeader() {
  const authContext = await getAuthContext();
  const workspaceHref =
    authContext.state === "authorized"
      ? authContext.role === "employee"
        ? "/employee"
        : "/manager"
      : "/login";

  return (
    <header className="sticky top-0 z-20 border-b border-rule bg-paper/95">
      <a
        className="fixed top-3 left-3 z-50 -translate-y-24 rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-paper transition-transform focus:translate-y-0 focus-visible:ring-3 focus-visible:ring-signal"
        href="#main-content"
      >
        {nlBE.navigation.skipToContent}
      </a>
      <div className="mx-auto flex min-h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link
          className="flex items-center gap-2 rounded-lg font-semibold text-ink outline-none focus-visible:ring-3 focus-visible:ring-focus"
          href="/"
        >
          <BrandMark />
          <span className="font-display text-xl tracking-[-0.02em]">
            {nlBE.brand.name}
          </span>
        </Link>

        <nav aria-label={nlBE.navigation.mainLabel} className="flex items-center gap-1">
          <Button asChild size="default" variant="quiet">
            <Link href={workspaceHref}>
              {authContext.state === "authorized"
                ? nlBE.navigation.workspace
                : nlBE.navigation.login}
              <ArrowRight aria-hidden="true" />
            </Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
