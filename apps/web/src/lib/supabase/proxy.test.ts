import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env/public", () => ({
  getPublicEnvironment: () => ({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: (
    _url: string,
    _key: string,
    options: {
      cookies: {
        setAll: (
          cookies: Array<{
            name: string;
            options: { httpOnly: boolean; path: string; secure: boolean };
            value: string;
          }>,
          headers: Record<string, string>,
        ) => void;
      };
    },
  ) => ({
    auth: {
      getClaims: async () => {
        options.cookies.setAll(
          [
            {
              name: "sb-session",
              options: { httpOnly: true, path: "/", secure: true },
              value: "refreshed-session",
            },
          ],
          {
            "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
            Expires: "0",
            Pragma: "no-cache",
          },
        );

        return { data: null, error: new Error("invalid session") };
      },
    },
  }),
}));

import { refreshSupabaseSession } from "./proxy";

describe("Supabase proxy", () => {
  it("preserves refreshed auth state on a protected-route redirect", async () => {
    const response = await refreshSupabaseSession(
      new NextRequest("http://localhost/employee?week=nu"),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      "http://localhost/login?volgende=%2Femployee%3Fweek%3Dnu",
    );
    expect(response.cookies.get("sb-session")?.value).toBe("refreshed-session");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });
});
