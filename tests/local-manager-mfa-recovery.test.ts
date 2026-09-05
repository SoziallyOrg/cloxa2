import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  executeRecoveryCommand,
  operatorDatabase,
  parseRecoveryArguments,
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
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("local manager MFA recovery CLI boundary", () => {
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
