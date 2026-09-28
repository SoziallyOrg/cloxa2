import "server-only";

import {
  inviteMember,
  linkInvitedUser,
  revokeInvitation,
  type CloxaClient,
  type InviteMemberInput,
} from "@cloxa/db";

import { createServiceClient } from "@/lib/supabase/server";

export interface SendInviteResult {
  readonly invitationId: string;
}

/**
 * The **only** place the service-role key is used to act on a user's
 * behalf, and only after `rpc_invite_member` (the caller's own, RLS-scoped
 * session) already succeeded. On email failure the invitation is revoked,
 * so a caller never sees a dangling "uitgenodigd" row with no email sent.
 */
export async function sendInvite(
  callerClient: CloxaClient,
  input: InviteMemberInput,
): Promise<SendInviteResult> {
  const invitationId = await inviteMember(callerClient, input);

  const service = createServiceClient();
  try {
    const { data, error } = await service.auth.admin.inviteUserByEmail(input.email);
    if (error || !data.user) {
      throw error ?? new Error("invite_user_by_email_failed");
    }
    await linkInvitedUser(service, { invitationId, userId: data.user.id });
  } catch (error) {
    try {
      await revokeInvitation(callerClient, { id: invitationId });
    } catch {
      // Best effort: the invitation stays open, but the failed email is the
      // real problem here and is already about to be thrown.
    }
    throw error;
  }

  return { invitationId };
}
