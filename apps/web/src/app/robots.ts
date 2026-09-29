import type { MetadataRoute } from "next";

import { env } from "@/lib/env.server";

/** The public pages may be indexed; the app itself (behind a login) may not. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/app", "/manage", "/kiosk", "/auth"],
    },
    sitemap: new URL("/sitemap.xml", env.CLOXA_SITE_URL).toString(),
  };
}
