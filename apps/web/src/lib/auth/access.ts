import type { Route } from "next";

import { getSafeManagerReturnPath } from "@/lib/auth/routes";

export type MembershipRole = "manager" | "employee";

export type ManagerMfaRecoveryState =
  | { state: "operator_action_required" | "expired" | "fresh_login_required" }
  | {
      state: "active";
      caseId: string;
      expiresAt: string;
    }
  | {
      state: "awaiting_operator";
      candidateId: string;
      caseId: string;
      expiresAt: string;
    };

export type AuthContext =
  | { state: "anonymous" }
  | { state: "unauthorized" | "unsupported"; userId: string }
  | {
      state:
        "manager_mfa_setup" | "manager_mfa_verify" | "manager_mfa_recovery_required";
      userId: string;
      organizationId: string;
      role: "manager";
      factorId?: string;
      recovery?: ManagerMfaRecoveryState;
    }
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
    if (context.state === "manager_mfa_setup") {
      return "/manager/security/setup" as const;
    }

    if (context.state === "manager_mfa_verify") {
      return "/manager/security/verify" as const;
    }

    if (context.state === "manager_mfa_recovery_required") {
      return "/manager/security/recovery-required" as const;
    }

    return "/unauthorized" as const;
  }

  return context.role === "manager" ? ("/manager" as const) : ("/employee" as const);
}

export function getAuthorizedPathWithReturn(
  context: AuthContext,
  requested: string | null | undefined,
): Route {
  const destination = getAuthorizedPath(context);

  if (!context.state.startsWith("manager_mfa_")) {
    return destination;
  }

  const next = getSafeManagerReturnPath(requested);
  return `${destination}?volgende=${encodeURIComponent(next)}` as Route;
}

export function resolveManagerMfaContext(
  context: Extract<AuthContext, { state: "authorized" }>,
  rows: unknown,
): AuthContext {
  if (context.role !== "manager") {
    return context;
  }

  if (!Array.isArray(rows) || rows.length !== 1) {
    return { state: "unauthorized", userId: context.userId };
  }

  const row: unknown = rows[0];

  if (!row || typeof row !== "object" || !("manager_mfa_state" in row)) {
    return { state: "unauthorized", userId: context.userId };
  }

  if (row.manager_mfa_state === "ready") {
    return context;
  }

  const base = {
    organizationId: context.organizationId,
    role: "manager" as const,
    userId: context.userId,
  };

  if (row.manager_mfa_state === "setup") {
    return { ...base, state: "manager_mfa_setup" };
  }

  if (row.manager_mfa_state === "recovery_required") {
    const recoveryState = "recovery_state" in row ? String(row.recovery_state) : "";
    if (
      ![
        "operator_action_required",
        "expired",
        "fresh_login_required",
        "active",
        "awaiting_operator",
      ].includes(recoveryState)
    ) {
      return { state: "unauthorized", userId: context.userId };
    }

    if (recoveryState === "active" || recoveryState === "awaiting_operator") {
      if (
        !("recovery_case_id" in row) ||
        !("recovery_expires_at" in row) ||
        typeof row.recovery_case_id !== "string" ||
        typeof row.recovery_expires_at !== "string" ||
        !row.recovery_case_id ||
        !row.recovery_expires_at
      ) {
        return { state: "unauthorized", userId: context.userId };
      }

      if (recoveryState === "awaiting_operator") {
        if (
          !("recovery_candidate_id" in row) ||
          typeof row.recovery_candidate_id !== "string" ||
          !row.recovery_candidate_id
        ) {
          return { state: "unauthorized", userId: context.userId };
        }
        return {
          ...base,
          recovery: {
            candidateId: row.recovery_candidate_id,
            caseId: row.recovery_case_id,
            expiresAt: row.recovery_expires_at,
            state: "awaiting_operator",
          },
          state: "manager_mfa_recovery_required",
        };
      }

      return {
        ...base,
        recovery: {
          caseId: row.recovery_case_id,
          expiresAt: row.recovery_expires_at,
          state: "active",
        },
        state: "manager_mfa_recovery_required",
      };
    }

    return {
      ...base,
      recovery: {
        state: recoveryState as Extract<
          ManagerMfaRecoveryState,
          { state: "operator_action_required" | "expired" | "fresh_login_required" }
        >["state"],
      },
      state: "manager_mfa_recovery_required",
    };
  }

  if (
    row.manager_mfa_state === "verify" &&
    "registered_factor_id" in row &&
    typeof row.registered_factor_id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      row.registered_factor_id,
    )
  ) {
    return {
      ...base,
      factorId: row.registered_factor_id,
      state: "manager_mfa_verify",
    };
  }

  return { state: "unauthorized", userId: context.userId };
}
