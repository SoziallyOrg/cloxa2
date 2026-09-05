import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CiLocalEnvError,
  createCiLocalEnvironment,
  planCiEnvironment,
  readSupabaseStatus,
  validateCiStatus,
  validateRepositoryConfig,
} from "../scripts/ci-local-env.mjs";

const status = {
  API_URL: "http://127.0.0.1:54321",
  DB_URL: "postgresql://postgres:fictional@127.0.0.1:54322/postgres",
  PUBLISHABLE_KEY: "fictional-public-key",
  SECRET_KEY: "fictional-server-key",
};
const config = `project_id = "cloxa2"

[api]
enabled = true
port = 54321

[db]
port = 54322
`;
const temporaryRoots: string[] = [];

async function temporaryRoot() {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(path.join(tmpdir(), "cloxa-ci-env-")),
  );
  temporaryRoots.push(root);
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  return root;
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("CI local environment preparation", () => {
  it("accepts only the repository's verified local stack", () => {
    expect(() => validateRepositoryConfig(config)).not.toThrow();
    expect(validateCiStatus(status)).toMatchObject({
      NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    });
  });

  it.each([
    ["hosted API", { ...status, API_URL: "https://project.supabase.co" }],
    ["hosted database", { ...status, DB_URL: "postgresql://hosted.example/db" }],
    ["malformed status", { ...status, API_URL: "not-a-url" }],
    ["missing API", { ...status, API_URL: undefined }],
    ["missing status", { ...status, DB_URL: undefined }],
    ["missing public key", { ...status, PUBLISHABLE_KEY: undefined }],
    ["missing secret key", { ...status, SECRET_KEY: undefined }],
    ["wrong API port", { ...status, API_URL: "http://127.0.0.1:54329" }],
  ])("refuses %s configuration", (_label, input) => {
    expect(() => validateCiStatus(input)).toThrow();
  });

  it.each([
    ["missing", undefined],
    ["missing root project", config.replace('project_id = "cloxa2"', "")],
    ["wrong project", config.replace("cloxa2", "another-project")],
    ["wrong API port", config.replace("54321", "54329")],
    ["wrong database port", config.replace("54322", "54329")],
  ])("refuses %s repository configuration", (_label, input) => {
    expect(() => validateRepositoryConfig(input)).toThrow();
  });

  it("accepts legacy local Supabase key names", () => {
    expect(
      validateCiStatus({
        ...status,
        ANON_KEY: status.PUBLISHABLE_KEY,
        PUBLISHABLE_KEY: undefined,
        SECRET_KEY: undefined,
        SERVICE_ROLE_KEY: status.SECRET_KEY,
      }),
    ).toMatchObject({ NEXT_PUBLIC_SUPABASE_URL: status.API_URL });
  });

  it("creates one restrictive ignored-style file and registers secrets separately", async () => {
    const root = await temporaryRoot();
    let byte = 0;
    const registerSecret = vi.fn();
    const target = await createCiLocalEnvironment({
      configSource: config,
      generateBytes: () => Buffer.alloc(32, (byte += 1)),
      registerSecret,
      root,
      status,
    });
    const source = await readFile(target, "utf8");

    expect(source).toContain('NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"');
    expect(source).toContain('CLOXA_LOCAL_MANAGER_EMAIL="manager.ci@example.test"');
    expect(registerSecret).toHaveBeenCalledTimes(5);
    expect(registerSecret).toHaveBeenCalledWith(status.SECRET_KEY);
    if (process.platform !== "win32") {
      expect((await stat(target)).mode & 0o777).toBe(0o600);
    }
  });

  it("refuses to overwrite an existing environment file", async () => {
    const root = await temporaryRoot();
    const target = path.join(root, "apps", "web", ".env.local");
    await writeFile(target, "existing-private-value", "utf8");

    await expect(
      createCiLocalEnvironment({ configSource: config, root, status }),
    ).rejects.toThrow("Refusing to overwrite");
    expect(await readFile(target, "utf8")).toBe("existing-private-value");
  });

  it("keeps generated values out of normal output", () => {
    const plan = planCiEnvironment(status, () => Buffer.alloc(32, 7));
    const safeOutput =
      "Ignored local CI environment created for the verified repository stack.";

    for (const secret of plan.secrets) expect(safeOutput).not.toContain(secret);
    expect(plan.secrets).toContain(status.SECRET_KEY);
  });

  it("propagates Supabase CLI failure status without exposing captured output", () => {
    const privateOutput = "SECRET_KEY=must-not-escape";
    const runCommand = vi.fn(() => ({
      error: undefined,
      status: 17,
      stderr: privateOutput,
      stdout: privateOutput,
    }));

    try {
      readSupabaseStatus(runCommand);
      expect.unreachable("status failure must throw");
    } catch (error) {
      expect(error).toBeInstanceOf(CiLocalEnvError);
      expect((error as CiLocalEnvError).exitCode).toBe(17);
      expect((error as Error).message).not.toContain(privateOutput);
    }
  });

  it("refuses malformed captured JSON without echoing it", () => {
    const privateOutput = '{"SECRET_KEY":"private"';
    const runCommand = vi.fn(() => ({
      error: undefined,
      status: 0,
      stderr: "",
      stdout: privateOutput,
    }));

    expect(() => readSupabaseStatus(runCommand)).toThrow("malformed status");
    try {
      readSupabaseStatus(runCommand);
    } catch (error) {
      expect((error as Error).message).not.toContain(privateOutput);
    }
  });
});
