import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { acceptMembership, type CloxaClient } from "@cloxa/db";

import { env } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

import { COOKIE } from "./cookies";
import { decideManageAccess, type ManageGate } from "./mfa";
import {
  chooseMembership,
  destinationFor,
  isPrivileged,
  isRole,
  type ActiveMembership,
  type RoutingState,
} from "./routing";
import { readActivity, readOrgChoice } from "./session-cookies";

export interface VerifiedClaims {
  userId: string;
  email: string | null;
  aal: unknown;
  amr: unknown;
}

export type AuthContext =
  | { kind: "anonymous" }
  | { kind: "none"; claims: VerifiedClaims }
  | { kind: "choose"; claims: VerifiedClaims; memberships: readonly ActiveMembership[] }
  | {
      kind: "member";
      claims: VerifiedClaims;
      membership: ActiveMembership;
      /** The user's active employee row in this organization, if any. */
      employeeId: string | null;
      memberships: readonly ActiveMembership[];
    };

interface MembershipRow {
  id: string;
  organization_id: string;
  role: string;
  status: string;
}

async function loadMemberships(
  supabase: CloxaClient,
  userId: string,
): Promise<MembershipRow[]> {
  const { data, error } = await supabase
    .from("memberships")
    .select("id, organization_id, role, status")
    .eq("user_id", userId);
  if (error) throw new Error(`memberships_unavailable:${error.code}`);
  return data;
}

async function activeMemberships(
  supabase: CloxaClient,
  userId: string,
): Promise<ActiveMembership[]> {
  let rows = await loadMemberships(supabase, userId);

  // First login after an invitation: activate the linked memberships.
  if (rows.some((row) => row.status === "invited")) {
    try {
      await acceptMembership(supabase);
      rows = await loadMemberships(supabase, userId);
    } catch (error) {
      // No PII: the RPC error code is enough to investigate.
      console.error("accept_membership_failed", (error as { code?: string }).code);
    }
  }

  const active = rows.filter((row) => row.status === "active" && isRole(row.role));
  if (active.length === 0) return [];

  const { data: organizations, error } = await supabase
    .from("organizations")
    .select("id, name")
    .in(
      "id",
      active.map((row) => row.organization_id),
    );
  if (error) throw new Error(`organizations_unavailable:${error.code}`);
  const names = new Map(organizations.map((org) => [org.id, org.name]));

  return active
    .map((row) => ({
      id: row.id,
      organizationId: row.organization_id,
      organizationName: names.get(row.organization_id) ?? "",
      role: row.role as ActiveMembership["role"],
    }))
    .sort((a, b) => a.organizationName.localeCompare(b.organizationName, "nl-BE"));
}

/**
 * Who is signed in and in which organization, from a verified JWT
 * (`getClaims`) plus RLS-scoped reads. Never from a decoded cookie alone.
 * Cached per request, so layouts and pages share one lookup.
 */
export const getAuthContext = cache(async (): Promise<AuthContext> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) return { kind: "anonymous" };

  const claims: VerifiedClaims = {
    userId: data.claims.sub,
    email: typeof data.claims.email === "string" ? data.claims.email : null,
    aal: data.claims.aal,
    amr: data.claims.amr,
  };

  const memberships = await activeMemberships(supabase, claims.userId);
  const cookieStore = await cookies();
  const selected = readOrgChoice(
    cookieStore.get(COOKIE.org)?.value,
    claims.userId,
    env.FLOW_COOKIE_SECRET,
  );
  const choice = chooseMembership(memberships, selected);

  if (choice.kind === "none") return { kind: "none", claims };
  if (choice.kind === "choose") return { kind: "choose", claims, memberships };

  const { data: employee, error } = await supabase
    .from("employees")
    .select("id")
    .eq("organization_id", choice.membership.organizationId)
    .eq("user_id", claims.userId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw new Error(`employee_unavailable:${error.code}`);

  return {
    kind: "member",
    claims,
    membership: choice.membership,
    employeeId: employee?.id ?? null,
    memberships,
  };
});

export function routingState(context: AuthContext): RoutingState {
  if (context.kind === "member") {
    return {
      kind: "member",
      role: context.membership.role,
      hasEmployee: context.employeeId !== null,
    };
  }
  return { kind: context.kind };
}

export type SignedInContext = Exclude<AuthContext, { kind: "anonymous" }>;
export type MemberContext = Extract<AuthContext, { kind: "member" }>;

/** Any signed-in user, with or without a membership. */
export async function requireSignedIn(): Promise<SignedInContext> {
  const context = await getAuthContext();
  if (context.kind === "anonymous") redirect("/login");
  return context;
}

/** `/app`: an active membership with an employee row. */
export async function requireEmployeeArea(): Promise<
  MemberContext & { employeeId: string }
> {
  const context = await getAuthContext();
  if (context.kind !== "member" || context.employeeId === null) {
    redirect(destinationFor(routingState(context)));
  }
  return context as MemberContext & { employeeId: string };
}

/** `/manage/beveiliging`: a privileged role, before MFA is checked. */
export async function requirePrivilegedRole(): Promise<MemberContext> {
  const context = await getAuthContext();
  if (context.kind !== "member" || !isPrivileged(context.membership.role)) {
    redirect(destinationFor(routingState(context)));
  }
  return context;
}

export async function hasVerifiedTotp(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return false;
  return data.totp.some((factor) => factor.status === "verified");
}

/** The pure `/manage` decision for the current request. */
export async function manageGate(context: MemberContext): Promise<ManageGate> {
  const cookieStore = await cookies();
  const now = Date.now();
  const input = {
    aal: context.claims.aal,
    amr: context.claims.amr,
    lastActivityAt: readActivity(
      cookieStore.get(COOKIE.activity)?.value,
      context.claims.userId,
      env.FLOW_COOKIE_SECRET,
      now,
    ),
    nowSeconds: Math.floor(now / 1000),
  };
  // Only look up factors when the answer matters (aal1 sessions).
  const hasVerifiedFactor = input.aal === "aal2" ? true : await hasVerifiedTotp();
  return decideManageAccess({ ...input, hasVerifiedFactor });
}

/** `/manage/**`: a privileged role with fresh MFA and recent activity. */
export async function requireManager(): Promise<MemberContext> {
  const context = await requirePrivilegedRole();
  const gate = await manageGate(context);
  if (gate.kind === "enroll") redirect("/manage/beveiliging/instellen");
  if (gate.kind === "verify") redirect("/manage/beveiliging/controle");
  return context;
}
