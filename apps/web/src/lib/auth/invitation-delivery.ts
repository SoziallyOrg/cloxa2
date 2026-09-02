import "server-only";

import { getLocalSiteOrigin } from "@/lib/auth/local-only";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/** Email and tenant come from authorized database state, never action arguments. */
export async function deliverEmployeeInvitation(invitationId: string): Promise<void> {
  const supabase = await createSupabaseServerClient();
  const { data: identity, error: identityError } = await supabase.auth.getUser();
  const { data: context, error: contextError } = await supabase.rpc("get_auth_context");
  const ownContext = context?.[0];
  if (
    identityError ||
    !identity.user ||
    contextError ||
    ownContext?.authorization_state !== "authorized" ||
    ownContext.membership_role !== "manager" ||
    !ownContext.organization_id
  ) {
    throw new Error("Invitation delivery unavailable.");
  }

  const { data: invitation, error } = await supabase
    .from("invitations")
    .select(
      "id, normalized_email, organization_id, invited_by, expires_at, status, intended_role",
    )
    .eq("id", invitationId)
    .eq("organization_id", ownContext.organization_id)
    .eq("invited_by", identity.user.id)
    .eq("status", "pending")
    .single();
  if (
    error ||
    !invitation ||
    invitation.intended_role !== "employee" ||
    new Date(invitation.expires_at).getTime() <= Date.now()
  ) {
    throw new Error("Invitation delivery unavailable.");
  }

  const admin = createSupabaseAdminClient();
  const { error: deliveryError } = await admin.auth.admin.inviteUserByEmail(
    invitation.normalized_email,
    { redirectTo: `${getLocalSiteOrigin()}/auth/callback` },
  );
  if (deliveryError) {
    // Auth/email cannot participate in the database transaction. Close an unsent
    // invitation safely; do not delete Auth users, rewrite audits, or expose why.
    await admin
      .from("invitations")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
      })
      .eq("id", invitation.id)
      .eq("status", "pending");
  }
}
