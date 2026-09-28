import type { Route } from "next";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { parseConfirmType, parseTokenHash, safeNextPath } from "@/lib/auth/redirects";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing point for email links (magic link, invitation, recovery):
 * `?token_hash=…&type=…[&next=/app]`. The token is exchanged server-side for
 * session cookies; `type` and `next` are checked against allowlists so the
 * link can neither pick an arbitrary flow nor redirect off-site.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const tokenHash = parseTokenHash(params.get("token_hash"));
  const type = parseConfirmType(params.get("type"));
  const next = safeNextPath(params.get("next")) ?? "/start";

  if (!tokenHash || !type) redirect("/login?fout=link");

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) redirect("/login?fout=link");

  // Passwordless app: a recovery link simply signs the user in.
  redirect(next as Route);
}
