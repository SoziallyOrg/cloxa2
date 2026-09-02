import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isProtectedRoute } from "@/lib/auth/routes";
import { getPublicEnvironment } from "@/lib/env/public";

export async function refreshSupabaseSession(request: NextRequest) {
  const environment = getPublicEnvironment();
  const pendingCookies: Array<{
    name: string;
    options: CookieOptions;
    value: string;
  }> = [];
  const pendingHeaders = new Headers();

  const supabase = createServerClient(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });

          pendingCookies.push(...cookiesToSet);

          Object.entries(headersToSet).forEach(([name, value]) => {
            pendingHeaders.set(name, value);
          });
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();

  if (isProtectedRoute(request.nextUrl.pathname) && (error || !data?.claims.sub)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "volgende",
      `${request.nextUrl.pathname}${request.nextUrl.search}`,
    );

    return applySupabaseResponseState(
      NextResponse.redirect(loginUrl),
      pendingCookies,
      pendingHeaders,
    );
  }

  return applySupabaseResponseState(
    NextResponse.next({ request }),
    pendingCookies,
    pendingHeaders,
  );
}

function applySupabaseResponseState(
  response: NextResponse,
  cookies: Array<{ name: string; options: CookieOptions; value: string }>,
  headers: Headers,
) {
  cookies.forEach(({ name, options, value }) => {
    response.cookies.set(name, value, options);
  });

  headers.forEach((value, name) => {
    response.headers.set(name, value);
  });

  return response;
}
