import type { Metadata } from "next";
import { connection } from "next/server";

import { t } from "@cloxa/i18n";

import "./globals.css";

export const metadata: Metadata = {
  title: t("common.appName"),
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
