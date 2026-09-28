/** Pure post-login routing: who goes where, given verified memberships. */

export const ROLES = ["owner", "admin", "manager", "employee"] as const;
export type Role = (typeof ROLES)[number];

const PRIVILEGED: ReadonlySet<Role> = new Set(["owner", "admin", "manager"]);

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function isPrivileged(role: Role): boolean {
  return PRIVILEGED.has(role);
}

export interface ActiveMembership {
  id: string;
  organizationId: string;
  organizationName: string;
  role: Role;
}

export type MembershipChoice =
  | { kind: "none" }
  | { kind: "choose"; memberships: readonly ActiveMembership[] }
  | { kind: "selected"; membership: ActiveMembership };

/**
 * One active membership is used directly. With several, the signed org cookie
 * picks one, but only if it still names an active membership: a stale or
 * foreign choice sends the user back to the chooser.
 */
export function chooseMembership(
  active: readonly ActiveMembership[],
  selectedOrganizationId: string | null,
): MembershipChoice {
  if (active.length === 0) return { kind: "none" };
  if (active.length === 1) return { kind: "selected", membership: active[0]! };

  const selected = active.find(
    (membership) => membership.organizationId === selectedOrganizationId,
  );
  return selected
    ? { kind: "selected", membership: selected }
    : { kind: "choose", memberships: active };
}

export type Destination =
  "/login" | "/app" | "/manage" | "/kies-organisatie" | "/geen-toegang";

/** Privileged roles land in `/manage`; employees need an employee row for `/app`. */
export function homeFor(role: Role, hasEmployee: boolean): Destination {
  if (isPrivileged(role)) return "/manage";
  return hasEmployee ? "/app" : "/geen-toegang";
}

export type RoutingState =
  | { kind: "anonymous" }
  | { kind: "none" }
  | { kind: "choose" }
  | { kind: "member"; role: Role; hasEmployee: boolean };

export function destinationFor(state: RoutingState): Destination {
  switch (state.kind) {
    case "anonymous":
      return "/login";
    case "none":
      return "/geen-toegang";
    case "choose":
      return "/kies-organisatie";
    case "member":
      return homeFor(state.role, state.hasEmployee);
  }
}
