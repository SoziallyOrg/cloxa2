import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type AuthFlowType = "invite" | "recovery";

export type AuthFlowProof = {
  type: AuthFlowType;
  userId: string;
  sessionId: string;
  expiresAt: number;
};

export const authFlowCookieName = "cloxa-auth-flow";
export const authFlowLifetimeSeconds = 15 * 60;

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`cloxa-auth-flow:v1:${payload}`).digest();
}

export function signAuthFlowProof(proof: AuthFlowProof, secret: string): string {
  const payload = Buffer.from(JSON.stringify(proof)).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifyAuthFlowProof(
  value: string | undefined,
  secret: string,
  now = Date.now(),
): AuthFlowProof | null {
  if (!value || value.length > 1024) return null;
  const parts = value.split(".");
  const payload = parts[0];
  const suppliedSignature = parts[1];
  if (parts.length !== 2 || !payload || !suppliedSignature) return null;

  try {
    const expected = signature(payload, secret);
    const supplied = Buffer.from(suppliedSignature, "base64url");
    if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) {
      return null;
    }
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!parsed || typeof parsed !== "object") return null;
    const proof = parsed as Partial<AuthFlowProof>;
    if (
      (proof.type !== "invite" && proof.type !== "recovery") ||
      typeof proof.userId !== "string" ||
      !proof.userId ||
      typeof proof.sessionId !== "string" ||
      !proof.sessionId ||
      typeof proof.expiresAt !== "number" ||
      !Number.isFinite(proof.expiresAt) ||
      proof.expiresAt <= now ||
      proof.expiresAt > now + authFlowLifetimeSeconds * 1000
    )
      return null;
    return proof as AuthFlowProof;
  } catch {
    return null;
  }
}
