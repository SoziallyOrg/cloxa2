import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 logs Server Action arguments and incoming URLs in development.
  // Auth passwords and email verification links must never enter those logs.
  logging: false,
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@cloxa/database", "@cloxa/domain"],
  typedRoutes: true,
};

export default nextConfig;
