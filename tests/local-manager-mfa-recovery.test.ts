import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeRecoveryCommand,
  operatorDatabase,
  parseRecoveryArguments,
  resolveLocalDockerEndpoint,
  runOperatorSql,
  runOperatorSqlAsync,
  validateLocalOperatorEnvironment,
  validateRecoveryEnvironment,
} from "../scripts/local-manager-mfa-recovery.mjs";

const target = "81000000-0000-4000-8000-000000000001";
const otherTarget = "81000000-0000-4000-8000-000000000002";
const operation = "82000000-0000-4000-8000-000000000001";
const caseId = "83000000-0000-4000-8000-000000000001";
const candidateId = "84000000-0000-4000-8000-000000000001";
const factorId = "85000000-0000-4000-8000-000000000001";
const roots: string[] = [];
const environment = {
  CLOXA_LOCAL_MANAGER_EMAIL: "manager.local@example.test",
  DOCKER_HOST: "unix:///var/run/docker.sock",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-public",
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "local-secret",
};
const status = {
  API_URL: "http://127.0.0.1:54321",
  DB_URL: "postgresql://postgres:private@127.0.0.1:54322/postgres",
  PUBLISHABLE_KEY: environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  SECRET_KEY: environment.SUPABASE_SECRET_KEY,
};
const config = `project_id = "cloxa2"

[api]
port = 54321

[db]
port = 54322
`;

async function localRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "cloxa-mfa-recovery-"));
  roots.push(root);
  await mkdir(path.join(root, "apps", "web"), { recursive: true });
  await mkdir(path.join(root, "supabase", ".temp"), { recursive: true });
  await writeFile(path.join(root, "apps", "web", ".env.local"), "ignored=true\n");
  await writeFile(path.join(root, "supabase", "config.toml"), config);
  return root;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

function syntheticChild(
  onKill: (signal: string, child: EventEmitter) => void = () => {},
) {
  const child = new EventEmitter() as EventEmitter & {
    kill: ReturnType<typeof vi.fn>;
    stderr: PassThrough;
    stdin: PassThrough;
    stdout: PassThrough;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn((signal: string) => onKill(signal, child));
  return child;
}

describe("local manager MFA recovery CLI boundary", () => {
  it.each([
    "unix:///var/run/docker.sock",
    "unix:///home/local/.docker/desktop/docker.sock",
    "npipe:////./pipe/docker_engine",
    "npipe:////./pipe/dockerDesktopLinuxEngine",
  ])("accepts and pins supported local Docker endpoint %s", (endpoint) => {
    const resolved = resolveLocalDockerEndpoint({
      environment: { DOCKER_HOST: endpoint },
      runCommand: vi.fn(),
    });

    expect(resolved.endpoint).toBe(endpoint);
    expect(resolved.environment).toMatchObject({ DOCKER_HOST: endpoint });
    expect(resolved.environment).not.toHaveProperty("DOCKER_CONTEXT");
  });

  it.each([
    "ssh://operator@remote.example.test",
    "tcp://127.0.0.1:2375",
    "npipe:////remote-host/pipe/docker_engine",
    "unix:////remote-share/docker.sock",
  ])("rejects unsupported or ambiguous Docker endpoint %s", (endpoint) => {
    const runCommand = vi.fn();
    expect(() =>
      resolveLocalDockerEndpoint({
        environment: { DOCKER_HOST: endpoint },
        runCommand,
      }),
    ).toThrow("local Unix socket or Windows named pipe");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("rejects a remote selected context when DOCKER_HOST is unset", () => {
    const runCommand = vi.fn(() =>
      JSON.stringify([
        {
          Name: "remote-build",
          Endpoints: { docker: { Host: "ssh://builder@remote.example.test" } },
        },
      ]),
    );

    expect(() =>
      resolveLocalDockerEndpoint({
        environment: { DOCKER_CONTEXT: "remote-build" },
        runCommand,
      }),
    ).toThrow("local Unix socket or Windows named pipe");
    expect(runCommand).toHaveBeenCalledExactlyOnceWith(
      "docker",
      ["context", "inspect", "remote-build"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("rejects conflicting Docker selectors before inspection", () => {
    const runCommand = vi.fn();
    expect(() =>
      resolveLocalDockerEndpoint({
        environment: {
          DOCKER_CONTEXT: "desktop-linux",
          DOCKER_HOST: "unix:///var/run/docker.sock",
        },
        runCommand,
      }),
    ).toThrow("conflicting");
    expect(runCommand).not.toHaveBeenCalled();
  });

  it("uses active-context precedence and fails closed on malformed inspection", () => {
    const valid = vi
      .fn()
      .mockReturnValueOnce("desktop-linux\n")
      .mockReturnValueOnce(
        JSON.stringify([
          {
            Name: "desktop-linux",
            Endpoints: {
              docker: { Host: "npipe:////./pipe/dockerDesktopLinuxEngine" },
            },
          },
        ]),
      );
    expect(
      resolveLocalDockerEndpoint({ environment: {}, runCommand: valid }),
    ).toMatchObject({
      endpoint: "npipe:////./pipe/dockerDesktopLinuxEngine",
    });
    expect(valid.mock.calls.map((call) => call[1])).toEqual([
      ["context", "show"],
      ["context", "inspect", "desktop-linux"],
    ]);

    const failed = vi.fn(() => {
      throw new Error("private Docker output");
    });
    expect(() =>
      resolveLocalDockerEndpoint({
        environment: { DOCKER_CONTEXT: "desktop-linux" },
        runCommand: failed,
      }),
    ).toThrow("Docker context inspection failed");
  });

  it("requires exact local, target, case, candidate and operation confirmations", () => {
    expect(
      parseRecoveryArguments([
        "complete",
        "--target-user",
        target,
        "--case-id",
        caseId,
        "--candidate-id",
        candidateId,
        "--operation-id",
        operation,
        "--confirm-local-development",
        "--confirm-target",
        target,
        "--confirm-case",
        caseId,
        "--confirm-candidate",
        candidateId,
      ]),
    ).toEqual({
      command: "complete",
      targetUserId: target,
      caseId,
      candidateId,
      operationId: operation,
    });

    for (const args of [
      ["start", "--target-user", target, "--operation-id", operation],
      [
        "start",
        "--target-user",
        target,
        "--operation-id",
        operation,
        "--confirm-local-development",
        "--confirm-target",
        otherTarget,
      ],
      [
        "status",
        "--target-user",
        target,
        "--case-id",
        "malformed",
        "--confirm-local-development",
        "--confirm-target",
        target,
        "--confirm-case",
        "malformed",
      ],
    ]) {
      expect(() => parseRecoveryArguments(args)).toThrow();
    }
  });

  it("accepts only exact repository and running local stack without hosted link", async () => {
    const root = await localRoot();
    await expect(
      validateRecoveryEnvironment({
        environment,
        getStatus: () => status,
        root,
        runCommand: vi.fn(),
      }),
    ).resolves.toMatchObject({
      managerEmail: environment.CLOXA_LOCAL_MANAGER_EMAIL,
      supabaseUrl: status.API_URL,
    });

    await expect(
      validateRecoveryEnvironment({
        environment: {
          ...environment,
          NEXT_PUBLIC_SUPABASE_URL: "https://localhost.supabase.co",
        },
        getStatus: () => status,
        root,
        runCommand: vi.fn(),
      }),
    ).rejects.toThrow();

    await expect(
      validateRecoveryEnvironment({
        environment,
        getStatus: () => ({ ...status, API_URL: "http://127.0.0.1:54329" }),
        root,
        runCommand: vi.fn(),
      }),
    ).rejects.toThrow("do not match project cloxa2");

    await writeFile(path.join(root, "supabase", ".temp", "project-ref"), "hosted");
    await expect(
      validateRecoveryEnvironment({
        environment,
        getStatus: () => status,
        root,
        runCommand: vi.fn(),
      }),
    ).rejects.toThrow("Hosted Supabase project link detected");
  });

  it("validates a local operator without requiring the retained manager identity", async () => {
    const root = await localRoot();
    const operatorEnvironment = {
      DOCKER_HOST: environment.DOCKER_HOST,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: environment.NEXT_PUBLIC_SUPABASE_URL,
      SUPABASE_SECRET_KEY: environment.SUPABASE_SECRET_KEY,
    };

    await expect(
      validateLocalOperatorEnvironment({
        environment: operatorEnvironment,
        getStatus: () => status,
        root,
        runCommand: vi.fn(),
      }),
    ).resolves.toMatchObject({
      dockerEndpoint: environment.DOCKER_HOST,
      stackStatus: status,
      supabaseUrl: status.API_URL,
    });
  });

  it("rejects a remote Docker host before the config status request", async () => {
    const getStatus = vi.fn();

    await expect(
      validateLocalOperatorEnvironment({
        environment: {
          ...environment,
          DOCKER_HOST: "ssh://operator@remote.example.test",
        },
        getStatus,
        runCommand: vi.fn(),
      }),
    ).rejects.toThrow("local Unix socket or Windows named pipe");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("rejects a remote Docker context before the config status request", async () => {
    const getStatus = vi.fn();
    const runCommand = vi.fn(() =>
      JSON.stringify([
        {
          Endpoints: { docker: { Host: "ssh://operator@remote.example.test" } },
          Name: "remote-build",
        },
      ]),
    );

    await expect(
      validateLocalOperatorEnvironment({
        environment: {
          ...environment,
          DOCKER_CONTEXT: "remote-build",
          DOCKER_HOST: undefined,
        },
        getStatus,
        runCommand,
      }),
    ).rejects.toThrow("local Unix socket or Windows named pipe");
    expect(runCommand).toHaveBeenCalledOnce();
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("refuses a remote Docker selector before Supabase or Auth inspection", async () => {
    const root = await localRoot();
    const getStatus = vi.fn();
    await expect(
      validateRecoveryEnvironment({
        environment: {
          ...environment,
          DOCKER_HOST: "ssh://operator@remote.example.test",
        },
        getStatus,
        root,
        runCommand: vi.fn(),
      }),
    ).rejects.toThrow("local Unix socket or Windows named pipe");
    expect(getStatus).not.toHaveBeenCalled();
  });

  it("pins the validated Docker endpoint for stack inspection and maintenance", async () => {
    const root = await localRoot();
    const getStatus = vi.fn(() => status);
    const settings = await validateRecoveryEnvironment({
      environment: {
        ...environment,
        DOCKER_CONTEXT: undefined,
        DOCKER_HOST: "unix:///var/run/docker.sock",
      },
      getStatus,
      root,
      runCommand: vi.fn(),
    });
    const stackEnvironment = getStatus.mock.calls[0]?.[0];
    expect(stackEnvironment).toEqual(
      expect.objectContaining({ DOCKER_HOST: "unix:///var/run/docker.sock" }),
    );
    expect(stackEnvironment).not.toHaveProperty("DOCKER_CONTEXT");

    const runCommand = vi.fn(() => '{"status":"ok"}');
    expect(
      runOperatorSql("select '{}'::jsonb;", {
        dockerEndpoint: settings.dockerEndpoint,
        environment: settings.dockerEnvironment,
        runCommand,
      }),
    ).toEqual({ status: "ok" });
    expect(runCommand).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["--host", "unix:///var/run/docker.sock", "exec"]),
      expect.objectContaining({
        env: expect.objectContaining({
          DOCKER_HOST: "unix:///var/run/docker.sock",
        }),
      }),
    );
    expect(runCommand.mock.calls[0]?.[2]).not.toHaveProperty("timeout");

    runOperatorSql("select '{}'::jsonb;", {
      dockerEndpoint: settings.dockerEndpoint,
      environment: settings.dockerEnvironment,
      runCommand,
      timeoutMs: 1_500,
    });
    expect(runCommand.mock.calls[1]?.[2]).toEqual(
      expect.objectContaining({ timeout: 1_500 }),
    );
    expect(() =>
      runOperatorSql("select '{}'::jsonb;", {
        dockerEndpoint: settings.dockerEndpoint,
        environment: settings.dockerEnvironment,
        runCommand,
        timeoutMs: 0,
      }),
    ).toThrow("No private database output was printed");
  });

  it("runs the opt-in SQL path asynchronously with the pinned local endpoint", async () => {
    const child = syntheticChild();
    const spawnCommand = vi.fn(() => child);
    const pending = runOperatorSqlAsync("select '{}'::jsonb;", {
      dockerEndpoint: "unix:///var/run/docker.sock",
      environment: { DOCKER_HOST: "unix:///var/run/docker.sock" },
      spawnCommand,
      timeoutMs: 1_000,
    });

    child.stdout.write('{"status":"ok"}\n');
    child.emit("close", 0, null);

    await expect(pending).resolves.toEqual({ status: "ok" });
    expect(spawnCommand).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["--host", "unix:///var/run/docker.sock", "exec"]),
      expect.objectContaining({
        env: expect.objectContaining({ DOCKER_HOST: "unix:///var/run/docker.sock" }),
      }),
    );
  });

  it("does not spawn async SQL after operation cancellation", async () => {
    const controller = new AbortController();
    const spawnCommand = vi.fn();
    controller.abort();

    await expect(
      runOperatorSqlAsync("select '{}'::jsonb;", {
        dockerEndpoint: "unix:///var/run/docker.sock",
        signal: controller.signal,
        spawnCommand,
      }),
    ).rejects.toThrow("No private database output was printed");
    expect(spawnCommand).not.toHaveBeenCalled();
  });

  it("waits for forced owned-child exit before rejecting async SQL", async () => {
    vi.useFakeTimers();
    const child = syntheticChild((signal, ownedChild) => {
      if (signal === "SIGKILL") ownedChild.emit("close", null, "SIGKILL");
    });
    const pending = runOperatorSqlAsync("select '{}'::jsonb;", {
      dockerEndpoint: "unix:///var/run/docker.sock",
      forceTerminationMs: 10,
      gracefulTerminationMs: 5,
      spawnCommand: vi.fn(() => child),
      timeoutMs: 25,
    });
    const rejected = expect(pending).rejects.toThrow(
      "Local recovery database operation failed",
    );

    await vi.advanceTimersByTimeAsync(30);
    await rejected;
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(child.listenerCount("error")).toBe(0);
  });

  it("uses fixed maintenance functions and UUID-only SQL values", () => {
    const call = vi.fn(() => ({ status: "ok" }));
    const database = operatorDatabase({ runOperatorSql: call });
    database.start(target, operation);
    database.status(target, caseId);
    database.complete(target, caseId, candidateId, operation);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls.flat().join("\n")).not.toContain("password");
    expect(() => database.start(`${target}'`, operation)).toThrow();
  });
});

describe("native provider removal sequencing", () => {
  function dependencies(factors: unknown[]) {
    const listFactors = vi
      .fn()
      .mockResolvedValueOnce({ data: { factors }, error: null })
      .mockResolvedValueOnce({ data: { factors: [] }, error: null });
    const deleteFactor = vi.fn().mockResolvedValue({
      data: { id: factorId },
      error: null,
    });
    const providerResult = vi.fn(({ removalSucceeded }) => ({
      case_id: caseId,
      status: removalSucceeded ? "awaiting_candidate" : "provider_removal_failed",
    }));
    return {
      admin: { auth: { admin: { mfa: { deleteFactor, listFactors } } } },
      database: {
        complete: vi.fn(),
        providerResult,
        start: vi.fn(() => ({
          case_id: caseId,
          factor_id: factorId,
          status: "provider_removal_pending",
        })),
        status: vi.fn(),
      },
      deleteFactor,
      listFactors,
      providerResult,
    };
  }

  const parsed = {
    command: "start",
    operationId: operation,
    targetUserId: target,
  } as const;

  it("establishes database denial before targeted Admin API deletion", async () => {
    const fixture = dependencies([
      { id: factorId, factor_type: "totp", status: "verified" },
    ]);
    await expect(executeRecoveryCommand(parsed, fixture)).resolves.toMatchObject({
      status: "awaiting_candidate",
    });
    expect(fixture.database.start.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.deleteFactor.mock.invocationCallOrder[0]!,
    );
    expect(fixture.deleteFactor).toHaveBeenCalledExactlyOnceWith({
      id: factorId,
      userId: target,
    });
    expect(fixture.providerResult).toHaveBeenLastCalledWith(
      expect.objectContaining({ removalSucceeded: true }),
    );
  });

  it("treats missing expected factor as response-loss replay", async () => {
    const fixture = dependencies([]);
    await executeRecoveryCommand(parsed, fixture);
    expect(fixture.deleteFactor).not.toHaveBeenCalled();
    expect(fixture.providerResult).toHaveBeenCalledWith(
      expect.objectContaining({ removalSucceeded: true }),
    );
  });

  it("leaves recovery blocked on provider failure or unrelated factor state", async () => {
    const providerFailure = dependencies([
      { id: factorId, factor_type: "totp", status: "verified" },
    ]);
    providerFailure.deleteFactor.mockResolvedValue({
      data: null,
      error: { message: "private provider detail" },
    });
    await expect(executeRecoveryCommand(parsed, providerFailure)).rejects.toThrow(
      "Manager access remains blocked",
    );
    expect(providerFailure.providerResult).toHaveBeenCalledWith(
      expect.objectContaining({ removalSucceeded: false }),
    );

    const unexpected = dependencies([
      { id: factorId, factor_type: "totp", status: "verified" },
      {
        id: "85000000-0000-4000-8000-000000000002",
        factor_type: "totp",
        status: "verified",
      },
    ]);
    await expect(executeRecoveryCommand(parsed, unexpected)).rejects.toThrow(
      "explicit operator review",
    );
    expect(unexpected.deleteFactor).not.toHaveBeenCalled();
  });
});
