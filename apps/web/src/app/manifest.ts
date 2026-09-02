import type { MetadataRoute } from "next";

import { nlBE } from "@/i18n/nl-BE";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#e7e3d8",
    description: nlBE.manifest.description,
    display: "standalone",
    icons: [
      {
        sizes: "any",
        src: "/icon.svg",
        type: "image/svg+xml",
      },
    ],
    lang: "nl-BE",
    name: nlBE.manifest.name,
    short_name: nlBE.manifest.shortName,
    start_url: "/",
    theme_color: "#0e4a67",
  };
}
