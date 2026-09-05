import "server-only";

import type { Database } from "@cloxa/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";

import {
  getAuthorizedPathWithReturn,
  resolveAuthContext,
  resolveManagerMfaContext,
  type AuthContext,
  type MembershipRole,
} from "@/lib/auth/access";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function getAuthContext(
  client?: SupabaseClient<Database>,
): Promise<AuthContext> {
  let verifiedUserId: string | null = null;

  try {
    const supabase = client ?? (await createSupabaseServerClient());
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
      return { state: "anonymous" };
    }

    verifiedUserId = userData.user.id;
    const { data, error } = await supabase.rpc("get_auth_context");
    const context = resolveAuthContext(verifiedUserId, error ? null : data);

    if (context.state !== "authorized" || context.role !== "manager") {
      return context;
    }

    const status = await supabase.rpc("get_manager_mfa_status");

    return resolveManagerMfaContext(context, status.error ? null : status.data);
  } catch {
    // Provider outages cannot turn a stale session into permission.
    return resolveAuthContext(verifiedUserId, null);
  }
}

export async function requireRole(role: MembershipRole, returnTo?: string) {
  const context = await getAuthContext();

  if (context.state !== "authorized") {
    redirect(getAuthorizedPathWithReturn(context, returnTo));
  }

  if (context.role !== role) {
    redirect("/unauthorized");
  }

  return context;
}
