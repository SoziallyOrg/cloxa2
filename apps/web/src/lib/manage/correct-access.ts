/**
 * Who is offered "Correctie toevoegen" for whom. Display logic only: the
 * database (`rpc_manager_correct`, ADR 010) enforces the same rules, so a
 * wrong guess here never lets a correction through, it only shows or hides a
 * button.
 */
import type { CloxaClient } from "@cloxa/db";

import { isRole, type Role } from "@/lib/auth/routing";

export interface CorrectionTarget {
  readonly employeeId: string;
  /** `null`: a person without a login (kiosk only). */
  readonly userId: string | null;
  /** Their role, when the viewer can read it; `undefined` when not. */
  readonly role: Role | undefined;
  /** Left the organisation or anonymised: nothing to correct any more. */
  readonly inactive?: boolean;
}

export interface CorrectionViewer {
  readonly role: Role;
  /** The viewer's own employee row, if any. */
  readonly employeeId: string | null;
}

/**
 * - nobody corrects someone who left;
 * - nobody but an owner corrects their own record;
 * - an owner corrects anyone, an admin anyone but an owner;
 * - a manager only employees and people without a login. A login-holder's
 *   role is unreadable for a manager, so they are offered it and the
 *   database has the final say.
 */
export function mayCorrect(
  viewer: CorrectionViewer,
  target: CorrectionTarget,
): boolean {
  if (target.inactive) return false;
  if (viewer.role === "employee") return false;
  if (viewer.employeeId !== null && viewer.employeeId === target.employeeId) {
    return viewer.role === "owner";
  }
  if (viewer.role === "owner") return true;
  if (viewer.role === "admin") return target.role !== "owner";
  if (target.userId === null) return true;
  return target.role === undefined || target.role === "employee";
}

/**
 * The roles of the given people, for owners and admins only (managers cannot
 * read memberships, so they get an empty map).
 */
export async function loadTargetRoles(
  supabase: CloxaClient,
  viewerRole: Role,
  organizationId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, Role>> {
  const roles = new Map<string, Role>();
  if ((viewerRole !== "owner" && viewerRole !== "admin") || userIds.length === 0) {
    return roles;
  }
  const { data, error } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("organization_id", organizationId)
    .in("user_id", [...userIds]);
  if (error) throw new Error(`memberships_unavailable:${error.code}`);
  for (const row of data) {
    if (row.user_id && isRole(row.role)) roles.set(row.user_id, row.role);
  }
  return roles;
}
