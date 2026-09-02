import { describe, expect, it } from "vitest";

import { parsePublicEnvironment, parseServerEnvironment } from "./schema";

const publicEnvironment = {
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-publishable-key",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
};

describe("environment validation", () => {
  it("accepts local Supabase public variables", () => {
    expect(parsePublicEnvironment(publicEnvironment)).toEqual(publicEnvironment);
  });

  it("rejects a malformed Supabase URL", () => {
    expect(() =>
      parsePublicEnvironment({
        ...publicEnvironment,
        NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      }),
    ).toThrow();
  });

  it("rejects missing public variables", () => {
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_SUPABASE_URL: publicEnvironment.NEXT_PUBLIC_SUPABASE_URL,
      }),
    ).toThrow();
  });

  it("does not allow a server secret key in the browser environment", () => {
    expect(() =>
      parsePublicEnvironment({
        ...publicEnvironment,
        SUPABASE_SECRET_KEY: "server-secret",
      }),
    ).toThrow();
  });

  it("requires the server secret key in the server environment", () => {
    expect(() => parseServerEnvironment(publicEnvironment)).toThrow();

    expect(
      parseServerEnvironment({
        ...publicEnvironment,
        SUPABASE_SECRET_KEY: "local-secret-key",
      }),
    ).toMatchObject({
      SUPABASE_SECRET_KEY: "local-secret-key",
    });
  });
});
