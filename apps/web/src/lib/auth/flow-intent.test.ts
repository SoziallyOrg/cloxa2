import type { Database } from "@cloxa/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCookie: vi.fn(),
  setCookie: vi.fn(),
  getUser: vi.fn(),
  getClaims: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mocks.getCookie, set: mocks.setCookie }),
}));
vi.mock("@/lib/env/server", () => ({
  getServerEnvironment: () => ({ SUPABASE_SECRET_KEY: "fictional-proof-secret" }),
}));

import { clearAuthFlowIntent, requireAuthFlow, setAuthFlowIntent } from "./flow-intent";
import {
  authFlowCookieName,
  signAuthFlowProof,
  verifyAuthFlowProof,
} from "./flow-proof";

const client = { auth: mocks } as unknown as SupabaseClient<Database>;
const proof = () =>
  signAuthFlowProof(
    {
      type: "invite",
      userId: "user-a",
      sessionId: "session-a",
      expiresAt: Date.now() + 900_000,
    },
    "fictional-proof-secret",
  );
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CLOXA_SITE_URL", "http://localhost:3000");
  mocks.getCookie.mockReturnValue({ value: proof() });
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user-a", email_confirmed_at: "confirmed" } },
    error: null,
  });
  mocks.getClaims.mockResolvedValue({
    data: { claims: { sub: "user-a", session_id: "session-a" } },
    error: null,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("password flow intent", () => {
  it("sets signed HTTP-only short-lived purpose cookie", () => {
    const response = NextResponse.next();
    setAuthFlowIntent(response, "invite", "user-a", "session-a");
    const cookie = response.cookies.get(authFlowCookieName)!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
      maxAge: 900,
    });
    expect(verifyAuthFlowProof(cookie.value, "fictional-proof-secret")).toMatchObject({
      type: "invite",
      userId: "user-a",
      sessionId: "session-a",
    });
  });

  it("accepts matching identity, session and purpose", async () => {
    expect(await requireAuthFlow("invite", client)).toBe(true);
  });

  it("does not turn invitation purpose into recovery", async () => {
    expect(await requireAuthFlow("recovery", client)).toBe(false);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.each([undefined, { value: "tampered-proof" }])(
    "rejects absent or tampered cookie",
    async (value) => {
      mocks.getCookie.mockReturnValue(value);
      expect(await requireAuthFlow("invite", client)).toBe(false);
      expect(mocks.getUser).not.toHaveBeenCalled();
    },
  );

  it.each([
    { data: { user: null }, error: null },
    {
      data: { user: { id: "other-user", email_confirmed_at: "confirmed" } },
      error: null,
    },
    { data: { user: { id: "user-a", email_confirmed_at: null } }, error: null },
    { data: { user: null }, error: { code: "invalid" } },
  ])("rejects unauthenticated, unverified or mismatched user", async (value) => {
    mocks.getUser.mockResolvedValue(value);
    expect(await requireAuthFlow("invite", client)).toBe(false);
  });

  it.each([
    {
      data: { claims: { sub: "user-a", session_id: "different-session" } },
      error: null,
    },
    {
      data: { claims: { sub: "different-user", session_id: "session-a" } },
      error: null,
    },
    { data: null, error: { code: "expired" } },
  ])("rejects changed or expired session", async (value) => {
    mocks.getClaims.mockResolvedValue(value);
    expect(await requireAuthFlow("invite", client)).toBe(false);
  });

  it("clears proof after use", async () => {
    await clearAuthFlowIntent();
    expect(mocks.setCookie).toHaveBeenCalledWith(
      authFlowCookieName,
      "",
      expect.objectContaining({ httpOnly: true, maxAge: 0 }),
    );
  });
});
