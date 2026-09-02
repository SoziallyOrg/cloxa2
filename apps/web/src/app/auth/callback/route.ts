import { NextResponse, type NextRequest } from "next/server";

import { nlBE } from "@/i18n/nl-BE";
import { getSafePostAuthPath } from "@/lib/auth/routes";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const nextPath = getSafePostAuthPath(request.nextUrl.searchParams.get("next"));
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("melding", nlBE.authCallback.failureCode);

  const response = NextResponse.redirect(loginUrl);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");

  if (code) {
    const supabase = createSupabaseRouteClient(request, response);
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      response.headers.set("Location", new URL(nextPath, request.url).toString());
    }
  }

  return response;
}
