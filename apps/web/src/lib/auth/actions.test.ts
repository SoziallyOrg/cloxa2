import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AttemptResult } from "./limiter";

/**
 * Server actions and the `/auth/confirm` page with Next, Supabase and the
 * limiter replaced by fakes: what gets verified, sent, set and where the
 * user is redirected.
 */

const state = vi.hoisted(() => ({
  cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
  afterCallbacks: [] as (() => Promise<void>)[],
  verifyOtp: vi.fn(),
  signInWithOtp: vi.fn(),
  createClient: vi.fn(),
  limiter: {
    otpRequest: { kind: "allowed" } as AttemptResult,
    otpVerify: { kind: "allowed" } as AttemptResult,
    linkVerify: { kind: "allowed" } as AttemptResult,
  },
  production: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const cookie = state.cookies.get(name);
      return cookie ? { name, value: cookie.value } : undefined;
    },
    getAll: () => [...state.cookies].map(([name, { value }]) => ({ name, value })),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      state.cookies.set(name, { value, options });
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`);
  },
}));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => state.afterCallbacks.push(callback),
}));
vi.mock("@/lib/env.server", () => ({
  env: {
    FLOW_COOKIE_SECRET: "f".repeat(32),
    AUTH_HASH_PEPPER: "p".repeat(32),
    CLOXA_SITE_URL: "https://cloxa.example",
    CLOXA_PROXY_MODE: { kind: "vercel" },
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  requestIsSecure: async () => state.production,
  createClient: state.createClient,
  createOtpSender: () => ({ auth: { signInWithOtp: state.signInWithOtp } }),
}));
vi.mock("./limiter", () => ({
  recordOtpRequest: async () => state.limiter.otpRequest,
  recordOtpVerify: async () => state.limiter.otpVerify,
  recordLinkVerify: async () => state.limiter.linkVerify,
  requestClientIp: async () => "203.0.113.7",
  resetEmailAttempts: async () => undefined,
  retryMinutes: (seconds: number) => Math.ceil(seconds / 60),
}));

const { confirmEmailLink } = await import("./actions/confirm");
const { requestCode, verifyCode } = await import("./actions/login");
const { default: ConfirmLinkPage } = await import("@/app/auth/confirm/page");
const { setCloxaCookie } = await import("./server-cookies");

const TOKEN = "a".repeat(56);
const INITIAL = { error: null };

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

/** Runs an action and returns where it redirected, or its returned state. */
async function outcome(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return (error as Error).message;
  }
}

beforeEach(() => {
  state.cookies.clear();
  state.afterCallbacks.length = 0;
  state.verifyOtp.mockReset().mockResolvedValue({ error: null });
  state.signInWithOtp.mockReset().mockResolvedValue({ error: null });
  state.createClient
    .mockReset()
    .mockResolvedValue({ auth: { verifyOtp: state.verifyOtp } });
  state.limiter.otpRequest = { kind: "allowed" };
  state.limiter.otpVerify = { kind: "allowed" };
  state.limiter.linkVerify = { kind: "allowed" };
  state.production = false;
});

describe("/auth/confirm", () => {
  it("GET renders a button and verifies nothing", async () => {
    const page = await ConfirmLinkPage({
      searchParams: Promise.resolve({ token_hash: TOKEN, type: "email", next: "/app" }),
    });
    expect(page).toBeTruthy();
    expect(state.createClient).not.toHaveBeenCalled();
    expect(state.verifyOtp).not.toHaveBeenCalled();
  });

  it("GET with a malformed link goes to the login page", async () => {
    await expect(
      ConfirmLinkPage({
        searchParams: Promise.resolve({ token_hash: TOKEN, type: "signup" }),
      }),
    ).rejects.toThrow("REDIRECT /login?fout=link");
  });

  it("POST verifies the token and follows an allowed next", async () => {
    const result = await outcome(() =>
      confirmEmailLink(
        INITIAL,
        form({ token_hash: TOKEN, type: "email", next: "/app" }),
      ),
    );
    expect(state.verifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN, type: "email" });
    expect(result).toBe("REDIRECT /app");
  });

  it("POST falls back to /start for an invalid next", async () => {
    const result = await outcome(() =>
      confirmEmailLink(
        INITIAL,
        form({ token_hash: TOKEN, type: "invite", next: "https://evil.example/app" }),
      ),
    );
    expect(result).toBe("REDIRECT /start");
  });

  it("POST is rate limited per IP and then spends no token", async () => {
    state.limiter.linkVerify = { kind: "blocked", retryAfterSeconds: 600 };
    const result = await outcome(() =>
      confirmEmailLink(INITIAL, form({ token_hash: TOKEN, type: "email" })),
    );
    expect(state.verifyOtp).not.toHaveBeenCalled();
    expect(result).toEqual({ error: expect.stringContaining("10 minuten") });
  });

  it("POST with a refused token goes to the login page", async () => {
    state.verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    const result = await outcome(() =>
      confirmEmailLink(INITIAL, form({ token_hash: TOKEN, type: "email" })),
    );
    expect(result).toBe("REDIRECT /login?fout=link");
  });
});

describe("requestCode", () => {
  it("sends the code after the response and starts a flow", async () => {
    const result = await outcome(() =>
      requestCode(INITIAL, form({ email: " Jan@Example.BE " })),
    );
    expect(result).toBe("REDIRECT /login/code");
    // Nothing is sent before the response is done.
    expect(state.signInWithOtp).not.toHaveBeenCalled();
    await Promise.all(state.afterCallbacks.map((callback) => callback()));
    expect(state.signInWithOtp).toHaveBeenCalledWith({
      email: "jan@example.be",
      options: { shouldCreateUser: false },
    });
    expect(state.cookies.get("cx_flow")?.value).toBeTruthy();
  });

  it("answers a rate-limited request exactly like an allowed one, without a flow or email", async () => {
    const allowed = await outcome(() =>
      requestCode(INITIAL, form({ email: "a@example.be" })),
    );
    state.cookies.clear();
    state.afterCallbacks.length = 0;
    state.limiter.otpRequest = { kind: "blocked", retryAfterSeconds: 900 };

    const blocked = await outcome(() =>
      requestCode(INITIAL, form({ email: "a@example.be" })),
    );

    expect(blocked).toBe(allowed);
    expect(state.afterCallbacks).toHaveLength(0);
    expect(state.cookies.has("cx_flow")).toBe(false);
  });

  it("a code typed without a flow is simply wrong", async () => {
    const result = await outcome(() => verifyCode(INITIAL, form({ code: "123456" })));
    expect(result).toEqual({ error: expect.stringContaining("klopt niet") });
    expect(state.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies a code within its flow", async () => {
    await outcome(() => requestCode(INITIAL, form({ email: "jan@example.be" })));
    const result = await outcome(() => verifyCode(INITIAL, form({ code: "123 456" })));
    expect(state.verifyOtp).toHaveBeenCalledWith({
      email: "jan@example.be",
      token: "123456",
      type: "email",
    });
    expect(result).toBe("REDIRECT /start");
  });
});

describe("cookie flags", () => {
  it("are Secure, httpOnly and SameSite=Lax in production", async () => {
    state.production = true;
    await setCloxaCookie("cx_test", "value", 60);
    expect(state.cookies.get("cx_test")?.options).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 60,
    });
  });
});
