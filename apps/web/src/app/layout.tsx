import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import { t } from "@cloxa/i18n";
import { colors } from "@cloxa/ui-tokens";

import "./globals.css";

export const metadata: Metadata = {
  title: t("common.appName"),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: colors.light.paper },
    { media: "(prefers-color-scheme: dark)", color: colors.dark.paper },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The nonce-based CSP (see proxy.ts) only works when every page renders per
  // request, so opt the whole app out of static prerendering here.
  await connection();

  return (
    <html lang="nl-BE">
      <body>{children}</body>
    </html>
  );
}
