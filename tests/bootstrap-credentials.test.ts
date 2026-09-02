import { describe, expect, it } from "vitest";

import { planLocalCredentials } from "../scripts/local-auth-credentials.mjs";

const status = {
  API_URL: "http://127.0.0.1:54321",
  PUBLISHABLE_KEY: "fictional-public-key",
  SECRET_KEY: "fictional-server-key",
};
const source = `# Preserve this comment\r\nNEXT_PUBLIC_SUPABASE_URL=${status.API_URL}\r\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}\r\nSUPABASE_SECRET_KEY=${status.SECRET_KEY}\r\n`;

describe("ignored local credential generation", () => {
  it("plans only missing fictional settings without rewriting source values", () => {
    const plan = planLocalCredentials(source, status);
    expect(plan.addedCount).toBe(5);
    expect(plan.addition.includes("NEXT_PUBLIC_SUPABASE")).toBe(false);
    expect(plan.addition.includes("SUPABASE_SECRET_KEY")).toBe(false);
    expect(plan.addition.includes("CLOXA_SITE_URL=http://localhost:3000\r\n")).toBe(
      true,
    );
    expect(
      plan.addition.includes(
        "CLOXA_LOCAL_MANAGER_EMAIL=manager.local@example.test\r\n",
      ),
    ).toBe(true);
    const lines = plan.addition.trim().split("\r\n");
    const passwords = lines
      .filter((line: string) => line.includes("_PASSWORD="))
      .map((line: string) => line.split("=")[1]);
    expect(passwords).toHaveLength(3);
    expect(
      passwords.every((password: string) => /^[A-Za-z0-9_-]{43}$/u.test(password)),
    ).toBe(true);
    expect(new Set(passwords).size).toBe(3);
  });

  it("reruns add nothing and preserve all prior credentials", () => {
    const first = planLocalCredentials(source, status);
    const second = planLocalCredentials(source + first.addition, status);
    expect(second).toEqual({ addition: "", addedCount: 0 });
  });

  it("refuses duplicate variables", () => {
    expect(() =>
      planLocalCredentials(source + "SUPABASE_SECRET_KEY=duplicate\n", status),
    ).toThrow("Duplicate local environment variable names are not permitted.");
  });

  it("refuses existing empty fixture values", () => {
    expect(() =>
      planLocalCredentials(source + "CLOXA_LOCAL_MANAGER_PASSWORD=\n", status),
    ).toThrow("Existing CLOXA_LOCAL_MANAGER_PASSWORD is empty.");
  });

  it("refuses nonfictional emails and hosted app URLs", () => {
    expect(() =>
      planLocalCredentials(
        source + "CLOXA_LOCAL_MANAGER_EMAIL=person@gmail.com\n",
        status,
      ),
    ).toThrow();
    expect(() =>
      planLocalCredentials(
        source + "CLOXA_SITE_URL=https://hosted.example.test\n",
        status,
      ),
    ).toThrow();
  });

  it("requires the existing keys and URL to match the local stack", () => {
    expect(() =>
      planLocalCredentials(source.replace(status.SECRET_KEY, "wrong-key"), status),
    ).toThrow();
    expect(() =>
      planLocalCredentials(
        source.replace(status.API_URL, "https://project.supabase.co"),
        status,
      ),
    ).toThrow();
  });
});
