import { NextResponse, type NextRequest } from "next/server";

import { nlBE } from "@/i18n/nl-BE";
import { getAuthorizedPath, resolveAuthContext } from "@/lib/auth/access";
import { setAuthFlowIntent } from "@/lib/auth/flow-intent";
import { authFlowCookieName } from "@/lib/auth/flow-proof";
import { getLocalSiteOrigin } from "@/lib/auth/local-only";
import { getSafePostAuthPath } from "@/lib/auth/routes";
import { createSupabaseRouteClient } from "@/lib/supabase/route";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const flowType = type === "invite" || type === "recovery" ? type : null;
  const flowPath = flowType === "invite" ? "/accept-invitation" : "/reset-password";
  const origin = getLocalSiteOrigin();
  const loginUrl = new URL("/login", origin);
  loginUrl.searchParams.set("melding", nlBE.authCallback.failureCode);

  const response = NextResponse.redirect(loginUrl);
  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Expires", "0");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.delete(authFlowCookieName);

  try {
    if (tokenHash && flowType && !code && tokenHash.length <= 256) {
      response.headers.set(
        "Location",
        new URL(`${flowPath}?melding=ongeldig`, origin).toString(),
      );
      const supabase = createSupabaseRouteClient(request, response);
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: flowType,
      });
      if (!error && data.user?.email_confirmed_at && data.session) {
        const { data: claimsData, error: claimsError } =
          await supabase.auth.getClaims();
        const sessionId = claimsData?.claims.session_id;
        if (
          !claimsError &&
          claimsData?.claims.sub === data.user.id &&
          typeof sessionId === "string"
        ) {
          setAuthFlowIntent(response, flowType, data.user.id, sessionId);
          response.headers.set("Location", new URL(flowPath, origin).toString());
        }
      }
    } else if (code && !tokenHash && code.length <= 2048) {
      const supabase = createSupabaseRouteClient(request, response);
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);

      if (!error) {
        // A browser's type/next parameter never proves a recovery or invitation flow.
        const { data: context, error: contextError } =
          await supabase.rpc("get_auth_context");
        const defaultPath = getAuthorizedPath(
          resolveAuthContext(data.user?.id ?? null, contextError ? null : context),
        );
        const nextPath = getSafePostAuthPath(request.nextUrl.searchParams.get("next"));
        response.headers.set(
          "Location",
          new URL(nextPath === defaultPath ? nextPath : defaultPath, origin).toString(),
        );
      }
    }
  } catch {
    // Provider/network errors must not serialize tokens or complete Auth objects.
    // The preselected generic failure destination remains in effect.
  }

  return response;
}
