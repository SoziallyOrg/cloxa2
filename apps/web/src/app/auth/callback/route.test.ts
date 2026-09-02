import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  getClaims: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  rpc: vi.fn(),
  setAuthFlowIntent: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/flow-intent", () => ({
  setAuthFlowIntent: mocks.setAuthFlowIntent,
}));
vi.mock("@/lib/supabase/route", () => ({
  createSupabaseRouteClient: () => ({ auth: mocks, rpc: mocks.rpc }),
}));

import { GET } from "./route";

const user = { id: "fictional-user", email_confirmed_at: "2026-09-02T10:00:00Z" };
const callback = (query: string) =>
  GET(new NextRequest(`http://localhost:3000/auth/callback?${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOXA_SITE_URL", "http://localhost:3000");
  mocks.verifyOtp.mockResolvedValue({ data: { user, session: {} }, error: null });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: user.id, session_id: "session-a" } },
    error: null,
  });
  mocks.exchangeCodeForSession.mockResolvedValue({ data: { user }, error: null });
  mocks.rpc.mockResolvedValue({
    data: [
      {
        authorization_state: "authorized",
        organization_id: "org-a",
        membership_role: "employee",
      },
    ],
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("auth callback", () => {
  it.each([
    ["invite", "/accept-invitation"],
    ["recovery", "/reset-password"],
  ])("verifies %s server-side then sets bound proof", async (type, path) => {
    const response = await callback(
      `token_hash=synthetic-hash&type=${type}&next=https://outside.test`,
    );
    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: "synthetic-hash",
      type,
    });
    expect(mocks.setAuthFlowIntent).toHaveBeenCalledWith(
      response,
      type,
      user.id,
      "session-a",
    );
    expect(response.headers.get("Location")).toBe(`http://localhost:3000${path}`);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Location")).not.toContain("synthetic-hash");
  });

  it.each(["expired", "revoked", "used", "mismatched"])(
    "returns same invitation failure for %s token",
    async () => {
      mocks.verifyOtp.mockResolvedValue({
        data: { user: null, session: null },
        error: { code: "otp_expired" },
      });
      const response = await callback("token_hash=synthetic-hash&type=invite");
      expect(response.headers.get("Location")).toBe(
        "http://localhost:3000/accept-invitation?melding=ongeldig",
      );
      expect(mocks.setAuthFlowIntent).not.toHaveBeenCalled();
    },
  );

  it.each([
    { data: { claims: { sub: "other-user", session_id: "session-a" } }, error: null },
    { data: { claims: { sub: user.id } }, error: null },
    { data: null, error: { code: "invalid" } },
  ])(
    "does not grant proof for missing or inconsistent verified claims",
    async (claims) => {
      mocks.getClaims.mockResolvedValue(claims);
      const response = await callback("token_hash=synthetic-hash&type=recovery");
      expect(mocks.setAuthFlowIntent).not.toHaveBeenCalled();
      expect(response.headers.get("Location")).toBe(
        "http://localhost:3000/reset-password?melding=ongeldig",
      );
    },
  );

  it("requires verified email and returned session", async () => {
    mocks.verifyOtp.mockResolvedValue({
      data: { user: { id: user.id }, session: null },
      error: null,
    });
    await callback("token_hash=synthetic-hash&type=invite");
    expect(mocks.setAuthFlowIntent).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "token_hash=hash&type=signup",
    "token_hash=hash&type=invite&code=code",
    `token_hash=${"x".repeat(257)}&type=invite`,
    `code=${"x".repeat(2049)}`,
  ])("rejects unsupported callback shape", async (query) => {
    const response = await callback(query);
    expect(response.headers.get("Location")).toBe(
      "http://localhost:3000/login?melding=aanmelding-mislukt",
    );
    expect(mocks.verifyOtp).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(mocks.setAuthFlowIntent).not.toHaveBeenCalled();
  });

  it.each([
    "https://outside.test",
    "//outside.test",
    "/manager",
    "/reset-password",
    "/accept-invitation",
  ])(
    "code exchange cannot elevate route or password purpose through next=%s",
    async (next) => {
      const response = await callback(
        `code=synthetic-code&type=recovery&next=${encodeURIComponent(next)}`,
      );
      expect(response.headers.get("Location")).toBe("http://localhost:3000/employee");
      expect(mocks.setAuthFlowIntent).not.toHaveBeenCalled();
    },
  );

  it("denies ambiguous membership without selecting a tenant", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          authorization_state: "unsupported",
          organization_id: null,
          membership_role: null,
        },
      ],
      error: null,
    });
    const response = await callback("code=synthetic-code");
    expect(response.headers.get("Location")).toBe(
      "http://localhost:3000/unauthorized?melding=meerdere-lidmaatschappen",
    );
  });

  it("uses configured local origin, not untrusted host", async () => {
    const response = await GET(
      new NextRequest("https://outside.test/auth/callback?code=synthetic-code"),
    );
    expect(response.headers.get("Location")).toBe("http://localhost:3000/employee");
  });

  it("conceals thrown provider failures", async () => {
    mocks.verifyOtp.mockRejectedValue(new Error("private provider diagnostic"));
    const response = await callback("token_hash=synthetic-hash&type=recovery");
    expect(response.headers.get("Location")).toBe(
      "http://localhost:3000/reset-password?melding=ongeldig",
    );
    expect(await response.text()).not.toContain("private provider diagnostic");
  });
});
