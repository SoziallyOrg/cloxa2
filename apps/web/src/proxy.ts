import type { NextRequest } from "next/server";

import { refreshSupabaseSession } from "@/lib/supabase/proxy";

export function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    "/employee/:path*",
    "/manager/:path*",
    "/login",
    "/forgot-password",
    "/reset-password",
    "/accept-invitation",
    "/unauthorized",
  ],
};
