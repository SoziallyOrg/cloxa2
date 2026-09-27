import type { MetadataRoute } from "next";

import { colors } from "@cloxa/ui-tokens";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cloxa",
    short_name: "Cloxa",
    display: "standalone",
    start_url: "/",
    theme_color: colors.primary,
    background_color: colors.paper,
    icons: [],
  };
}
