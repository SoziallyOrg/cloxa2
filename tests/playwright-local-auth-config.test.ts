import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  getStatus: vi.fn(),
  runCommand: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  execFileSync: harness.runCommand,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    lstat: vi.fn(async (filename: string) => {
      const value = String(filename).replaceAll("\\", "/");
      if (value.endsWith("/apps/web/.env.local")) {
        return {
          isFile: () => true,
          isSymbolicLink: () => false,
          nlink: 1,
        };
      }
      if (value.endsWith("/supabase/.temp/project-ref")) {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      }
      return actual.lstat(filename);
    }),
  };
});

vi.mock("../scripts/local-auth-config.mjs", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../scripts/local-auth-config.mjs")>();
  return {
    ...actual,
    getLocalStackStatus: harness.getStatus,
    loadLocalEnvironment: vi.fn(),
  };
});

const controlledKeys = [
  "CLOXA_E2E_PRODUCTION",
  "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
  "CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD",
  "CLOXA_LOCAL_MAILPIT_URL",
  "CLOXA_SITE_URL",
  "DOCKER_CERT_PATH",
  "DOCKER_CONTEXT",
  "DOCKER_HOST",
  "DOCKER_TLS",
  "DOCKER_TLS_VERIFY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "PLAYWRIGHT_NO_COPY_PROMPT",
  "SUPABASE_SECRET_KEY",
] as const;
const originalEnvironment = new Map<string, string | undefined>();
const status = {
  API_URL: "http://127.0.0.1:54321",
  DB_URL: "postgresql://postgres:private@127.0.0.1:54322/postgres",
  MAILPIT_URL: "http://127.0.0.1:54324",
  PUBLISHABLE_KEY: "local-public",
  SECRET_KEY: "local-secret",
};

async function importConfig() {
  return (await import("../playwright.local-auth.config.ts")).default;
}

beforeEach(() => {
  vi.resetModules();
  harness.getStatus.mockReset().mockReturnValue(status);
  harness.runCommand.mockReset().mockImplementation((command, args) => {
    if (command === "git" && args[0] === "check-ignore") return "";
    if (command === "docker" && args[0] === "context" && args[1] === "inspect") {
      return JSON.stringify([
        {
          Endpoints: { docker: { Host: "ssh://operator@remote.example.test" } },
          Name: args[2],
        },
      ]);
    }
    throw new Error("Unexpected external command in config test.");
  });

  for (const key of controlledKeys) {
    originalEnvironment.set(key, process.env[key]);
    delete process.env[key];
  }
  Object.assign(process.env, {
    CLOXA_LOCAL_EMPLOYEE_PASSWORD: "synthetic-password-only",
    CLOXA_LOCAL_EMPLOYEE_RESET_PASSWORD: "synthetic-reset-password-only",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    SUPABASE_SECRET_KEY: status.SECRET_KEY,
  });
});

afterEach(() => {
  for (const key of controlledKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  originalEnvironment.clear();
});

describe("dedicated local Auth Playwright configuration", () => {
  it("pins a local Docker endpoint and disables credential-bearing artifacts", async () => {
    process.env.DOCKER_HOST = "unix:///var/run/docker.sock";

    const config = await importConfig();

    expect(harness.getStatus).toHaveBeenCalledOnce();
    expect(harness.getStatus).toHaveBeenCalledWith(
      expect.objectContaining({ DOCKER_HOST: "unix:///var/run/docker.sock" }),
    );
    expect(harness.getStatus.mock.calls[0]?.[0]).not.toHaveProperty("DOCKER_CONTEXT");
    expect(config.testMatch).toEqual(/local-auth\.spec\.mts/u);
    expect(config.workers).toBe(1);
    expect(config.use).toMatchObject({ screenshot: "off", trace: "off", video: "off" });
    expect(config).not.toHaveProperty("globalSetup");
    expect(process.env.DOCKER_HOST).toBe("unix:///var/run/docker.sock");
    expect(process.env.DOCKER_CONTEXT).toBeUndefined();
  });

  it("rejects a remote Docker host before status inspection", async () => {
    process.env.DOCKER_HOST = "ssh://operator@remote.example.test";

    await expect(importConfig()).rejects.toThrow(
      "local Unix socket or Windows named pipe",
    );
    expect(harness.getStatus).not.toHaveBeenCalled();
    expect(harness.runCommand).not.toHaveBeenCalled();
  });

  it("rejects a remote Docker context before status inspection", async () => {
    process.env.DOCKER_CONTEXT = "remote-build";

    await expect(importConfig()).rejects.toThrow(
      "local Unix socket or Windows named pipe",
    );
    expect(harness.runCommand).toHaveBeenCalledWith(
      "docker",
      ["context", "inspect", "remote-build"],
      expect.objectContaining({
        env: expect.not.objectContaining({ DOCKER_CONTEXT: "remote-build" }),
      }),
    );
    expect(harness.getStatus).not.toHaveBeenCalled();
  });
});
