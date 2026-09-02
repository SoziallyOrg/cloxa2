import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "@fontsource/barlow-condensed/600.css";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { nlBE } from "@/i18n/nl-BE";

import "./globals.css";

export const metadata: Metadata = {
  applicationName: nlBE.brand.name,
  description: nlBE.metadata.defaultDescription,
  manifest: "/manifest.webmanifest",
  title: {
    default: nlBE.metadata.defaultTitle,
    template: `%s · ${nlBE.brand.name}`,
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#0e4a67",
};

const designContract = `<!--
THESIS: Corrections remain attached to their original record; this refuses the generic rounded HR dashboard.
OWN-WORLD: Daylight docket paper, deep ink, cobalt fields, amber status marks, ruled sections, and compact worksite labels.
STORY: Visitors understand invite-only scope, see the future review chain, and choose the sign-in route without mistaking shells for finished workflows.
FIRST VIEWPORT: A compact worksite header leads into one broad ruled dossier: claim and action left, four-step record chain right, readable at 320px.
FORM: Quality-control traveler docket, grounded direction 7; seed 4cf65f85.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="nl-BE">
      <body className="flex min-h-screen flex-col antialiased">
        <template
          aria-hidden="true"
          data-impeccable-contract
          dangerouslySetInnerHTML={{ __html: designContract }}
        />
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
