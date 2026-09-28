import { fileURLToPath } from "node:url";

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
  // Standalone server.js for the Docker image (see /Dockerfile). The repo
  // root, not this app's directory, is where the pnpm workspace's lockfile
  // and node_modules live, so Next's file tracing needs pointing there
  // explicitly — otherwise it infers the wrong root in a monorepo and the
  // standalone bundle can miss (or over-include) files.
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  output: "standalone",
  experimental: {
    serverActions: {
      allowedOrigins: siteHost(),
    },
  },
};

export default nextConfig;
