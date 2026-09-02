export type MembershipRole = "manager" | "employee";

export type AuthContext =
  | { state: "anonymous" }
  | { state: "unauthorized" | "unsupported"; userId: string }
  | {
      state: "authorized";
      userId: string;
      organizationId: string;
      role: MembershipRole;
    };

/** Fail closed on malformed, absent, or ambiguous database context. */
export function resolveAuthContext(userId: string | null, rows: unknown): AuthContext {
  if (!userId) {
    return { state: "anonymous" };
  }

  if (!Array.isArray(rows) || rows.length !== 1) {
    return {
      state:
        rows && Array.isArray(rows) && rows.length > 1 ? "unsupported" : "unauthorized",
      userId,
    };
  }

  const row: unknown = rows[0];

  if (!row || typeof row !== "object" || !("authorization_state" in row)) {
    return { state: "unauthorized", userId };
  }

  if (row.authorization_state === "unsupported") {
    return { state: "unsupported", userId };
  }

  if (
    row.authorization_state !== "authorized" ||
    !("organization_id" in row) ||
    typeof row.organization_id !== "string" ||
    !row.organization_id ||
    !("membership_role" in row) ||
    (row.membership_role !== "manager" && row.membership_role !== "employee")
  ) {
    return { state: "unauthorized", userId };
  }

  return {
    organizationId: row.organization_id,
    role: row.membership_role,
    state: "authorized",
    userId,
  };
}

export function getAuthorizedPath(context: AuthContext) {
  if (context.state === "anonymous") {
    return "/login" as const;
  }

  if (context.state === "unsupported") {
    return "/unauthorized?melding=meerdere-lidmaatschappen" as const;
  }

  if (context.state !== "authorized") {
    return "/unauthorized" as const;
  }

  return context.role === "manager" ? ("/manager" as const) : ("/employee" as const);
}
