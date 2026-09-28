import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import { t } from "@cloxa/i18n";
import { colors } from "@cloxa/ui-tokens";

// Self-hosted Inter: the SF-like stand-in where San Francisco isn't installed.
import "@fontsource-variable/inter/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: t("common.appName"),
  applicationName: t("common.appName"),
  // "Add to Home Screen" opens full screen, like an app. `appleWebApp` emits
  // the standard `mobile-web-app-capable`; older iOS only reads the prefixed one.
  appleWebApp: {
    capable: true,
    title: t("common.appName"),
    statusBarStyle: "default",
  },
  other: { "apple-mobile-web-app-capable": "yes" },
  formatDetection: { telephone: false },
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
