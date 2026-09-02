import { NextRequest, NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { createServerClientMock } = vi.hoisted(() => ({
  createServerClientMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: createServerClientMock,
}));
vi.mock("@/lib/env/public", () => ({
  getPublicEnvironment: () => ({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
    NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  }),
}));

import { createSupabaseRouteClient } from "./route";

describe("Supabase route client", () => {
  beforeEach(() => {
    createServerClientMock.mockReset();
  });

  it("applies auth cookies and mandatory cache headers to the route response", () => {
    createServerClientMock.mockImplementation(
      (_url: string, _key: string, options: unknown) => options,
    );

    const request = new NextRequest("http://localhost/auth/callback", {
      headers: { cookie: "pkce-verifier=known" },
    });
    const response = NextResponse.redirect(new URL("/employee", request.url));
    const client = createSupabaseRouteClient(request, response) as unknown as {
      cookies: {
        getAll: () => Array<{ name: string; value: string }>;
        setAll: (
          cookies: Array<{
            name: string;
            options: { httpOnly: boolean; path: string; secure: boolean };
            value: string;
          }>,
          headers: Record<string, string>,
        ) => void;
      };
    };

    expect(client.cookies.getAll()).toContainEqual({
      name: "pkce-verifier",
      value: "known",
    });

    client.cookies.setAll(
      [
        {
          name: "sb-session",
          options: { httpOnly: true, path: "/", secure: true },
          value: "session-value",
        },
      ],
      {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
      },
    );

    expect(response.cookies.get("sb-session")?.value).toBe("session-value");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Expires")).toBe("0");
    expect(response.headers.get("Pragma")).toBe("no-cache");
  });
});
