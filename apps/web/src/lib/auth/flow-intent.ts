import "server-only";

import type { Database } from "@cloxa/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";

import {
  authFlowCookieName,
  authFlowLifetimeSeconds,
  signAuthFlowProof,
  verifyAuthFlowProof,
  type AuthFlowType,
} from "@/lib/auth/flow-proof";
import { getServerEnvironment } from "@/lib/env/server";
import { getAuthCookieOptions } from "@/lib/supabase/cookies";

/** Called only after successful Auth token verification, never from URL claims. */
export function setAuthFlowIntent(
  response: NextResponse,
  type: AuthFlowType,
  userId: string,
  sessionId: string,
): void {
  response.cookies.set(
    authFlowCookieName,
    signAuthFlowProof(
      {
        type,
        userId,
        sessionId,
        expiresAt: Date.now() + authFlowLifetimeSeconds * 1000,
      },
      getServerEnvironment().SUPABASE_SECRET_KEY,
    ),
    { ...getAuthCookieOptions(), maxAge: authFlowLifetimeSeconds },
  );
}

export async function requireAuthFlow(
  type: AuthFlowType,
  supabase: SupabaseClient<Database>,
): Promise<boolean> {
  const proof = verifyAuthFlowProof(
    (await cookies()).get(authFlowCookieName)?.value,
    getServerEnvironment().SUPABASE_SECRET_KEY,
  );
  if (!proof || proof.type !== type) return false;

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (
    userError ||
    !userData.user?.email_confirmed_at ||
    userData.user.id !== proof.userId
  ) {
    return false;
  }
  const { data, error } = await supabase.auth.getClaims();
  return (
    !error &&
    data?.claims.sub === proof.userId &&
    data.claims.session_id === proof.sessionId
  );
}

export async function clearAuthFlowIntent(): Promise<void> {
  (await cookies()).set(authFlowCookieName, "", {
    ...getAuthCookieOptions(),
    maxAge: 0,
  });
}
