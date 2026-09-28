import type { NextConfig } from "next";

/**
 * Server actions only accept POSTs whose Origin matches the Host header, plus
 * these origins. Pinning our own site host keeps actions working behind a
 * proxy that rewrites Host, without allowing anything else.
 */
function siteHost(): string[] {
  try {
    return process.env["CLOXA_SITE_URL"]
      ? [new URL(process.env["CLOXA_SITE_URL"]).host]
      : [];
  } catch {
    return [];
  }
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  experimental: {
    serverActions: {
      allowedOrigins: siteHost(),
    },
  },
};

export default nextConfig;
