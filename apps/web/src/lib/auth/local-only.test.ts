import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { assertLocalOrigin, getLocalSiteOrigin, localOnlyFetch } from "./local-only";
import { getAuthCookieOptions } from "../supabase/cookies";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local-only auth endpoints", () => {
  it.each(["http://localhost:3000", "http://127.0.0.1:54321", "https://[::1]:3000/"])(
    "accepts canonical loopback %s",
    (url) => {
      expect(assertLocalOrigin(url)).toBe(new URL(url).origin);
    },
  );

  it.each([
    "https://project.supabase.co",
    "//localhost",
    "http://localhost.evil.test",
    "http://localhost@evil.test",
    "http://u:p@localhost",
    "http://localhost/path",
    "http://localhost?next=https://evil.test",
    "http://localhost#fragment",
    "ftp://localhost",
    "http://127.1",
    "http://2130706433",
    "http://0x7f000001",
    "http://localhost\\@evil.test",
  ])("rejects non-local or non-origin %s", (url) => {
    expect(() => assertLocalOrigin(url)).toThrow();
  });

  it("blocks hosted fetches before network access", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() =>
      localOnlyFetch("https://project.supabase.co/auth/v1/invite"),
    ).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects redirects even if a caller asks to follow them", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);
    await localOnlyFetch("http://127.0.0.1:54321/auth/v1/invite", {
      redirect: "follow",
    });
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:54321/auth/v1/invite", {
      redirect: "error",
    });
  });

  it("refuses embedded URL credentials", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(() => localOnlyFetch("http://u:p@localhost:54321/path")).toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "always uses HTTP-only same-site cookies; HTTPS=%s",
    (https) => {
      vi.stubEnv("CLOXA_SITE_URL", `${https ? "https" : "http"}://localhost:3000`);
      expect(getLocalSiteOrigin()).toBe(`${https ? "https" : "http"}://localhost:3000`);
      expect(getAuthCookieOptions()).toEqual({
        httpOnly: true,
        path: "/",
        sameSite: "lax",
        secure: https,
      });
    },
  );
});
