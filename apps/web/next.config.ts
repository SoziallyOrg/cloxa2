import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@cloxa/database", "@cloxa/domain"],
  typedRoutes: true,
};

export default nextConfig;
