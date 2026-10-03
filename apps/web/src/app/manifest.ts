import type { MetadataRoute } from "next";

import { colors } from "@cloxa/ui-tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cloxa",
    short_name: "Cloxa",
    display: "standalone",
    start_url: "/",
    theme_color: colors.light.forest,
    background_color: colors.light.paper,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
