import "server-only";

import type { CookieOptions } from "@supabase/ssr";

import { getLocalSiteOrigin } from "@/lib/auth/local-only";

export function getAuthCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    // HTTP is permitted only for this phase's explicit loopback origin.
    secure: new URL(getLocalSiteOrigin()).protocol === "https:",
  };
}
