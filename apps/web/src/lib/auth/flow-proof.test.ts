import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  signAuthFlowProof,
  verifyAuthFlowProof,
  type AuthFlowProof,
} from "./flow-proof";

const now = 1_800_000_000_000;
const secret = "fictional-unit-test-signing-key";
const proof: AuthFlowProof = {
  type: "invite",
  userId: "user-a",
  sessionId: "session-a",
  expiresAt: now + 900_000,
};

describe("short-lived signed password flow proof", () => {
  it.each(["invite", "recovery"] as const)("verifies signed %s purpose", (type) => {
    const expected = { ...proof, type };
    expect(
      verifyAuthFlowProof(signAuthFlowProof(expected, secret), secret, now),
    ).toEqual(expected);
  });

  it("rejects another signing key", () => {
    expect(
      verifyAuthFlowProof(signAuthFlowProof(proof, secret), "wrong-key", now),
    ).toBeNull();
  });

  it.each([undefined, "", "not-a-proof", "a.b.c", ".", "x".repeat(1025)])(
    "rejects malformed proof %s",
    (value) => {
      expect(verifyAuthFlowProof(value, secret, now)).toBeNull();
    },
  );

  it.each([
    { expiresAt: now },
    { expiresAt: now - 1 },
    { expiresAt: now + 900_001 },
    { userId: "" },
    { sessionId: "" },
    { type: "signup" },
    { expiresAt: "later" },
  ])("rejects invalid claims %j", (override) => {
    const invalid = { ...proof, ...override } as AuthFlowProof;
    expect(
      verifyAuthFlowProof(signAuthFlowProof(invalid, secret), secret, now),
    ).toBeNull();
  });

  it("rejects edited identity, session and purpose without a valid signature", () => {
    const signed = signAuthFlowProof(proof, secret);
    const signature = signed.split(".")[1];
    for (const change of [
      { userId: "user-b" },
      { sessionId: "session-b" },
      { type: "recovery" },
    ]) {
      const payload = Buffer.from(JSON.stringify({ ...proof, ...change })).toString(
        "base64url",
      );
      expect(verifyAuthFlowProof(`${payload}.${signature}`, secret, now)).toBeNull();
    }
  });
});
