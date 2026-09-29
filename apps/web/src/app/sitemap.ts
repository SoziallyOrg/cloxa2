import type { MetadataRoute } from "next";

import { env } from "@/lib/env.server";

const PATHS = [
  "/",
  "/aanvragen",
  "/privacy",
  "/voorwaarden",
  "/verwerkersovereenkomst",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: new URL(path, env.CLOXA_SITE_URL).toString() }));
}
