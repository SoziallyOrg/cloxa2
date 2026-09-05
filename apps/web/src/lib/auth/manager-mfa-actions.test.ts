import { beforeEach, describe, expect, it, vi } from "vitest";

import { nlBE } from "@/i18n/nl-BE";

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getAuthContext: vi.fn(),
  enroll: vi.fn(),
  listFactors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  rpc: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.getAuthContext }));

import {
  completeManagerMfaEnrollmentAction,
  startManagerMfaEnrollmentAction,
  verifyManagerMfaAction,
} from "./manager-mfa-actions";

const factorId = "123e4567-e89b-42d3-a456-426614174000";
const registeredFactorId = "123e4567-e89b-42d3-a456-426614174001";
const qrCode = "data:image/svg+xml;base64,PHN2Zy8+";
const secret = "JBSWY3DPEHPK3PXP";
const client = {
  auth: {
    mfa: {
      enroll: mocks.enroll,
      listFactors: mocks.listFactors,
      challenge: mocks.challenge,
      verify: mocks.verify,
    },
  },
  rpc: mocks.rpc,
};
const setupContext = {
  state: "manager_mfa_setup",
  userId: "manager-one",
  organizationId: "organization-one",
  role: "manager",
};
const readyContext = {
  state: "authorized",
  userId: "manager-one",
  organizationId: "organization-one",
  role: "manager",
};
const idle = { status: "idle", message: "" } as const;

function form(fields: Record<string, string> = {}) {
  const result = new FormData();
  for (const [name, value] of Object.entries(fields)) result.set(name, value);
  return result;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.createServerClient.mockResolvedValue(client);
  mocks.getAuthContext.mockResolvedValue(setupContext);
  mocks.enroll.mockResolvedValue({
    data: { id: factorId, type: "totp", totp: { qr_code: qrCode, secret } },
    error: null,
  });
  mocks.listFactors.mockResolvedValue({
    data: {
      all: [{ id: factorId, factor_type: "totp", status: "unverified" }],
    },
    error: null,
  });
  mocks.challenge.mockResolvedValue({ data: { id: "challenge-one" }, error: null });
  mocks.verify.mockResolvedValue({ data: { access_token: "redacted" }, error: null });
  mocks.rpc.mockResolvedValue({ data: "ready", error: null });
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`);
  });
});

describe("manager TOTP enrollment", () => {
  it("uses native Supabase enrollment and returns only setup display fields", async () => {
    await expect(startManagerMfaEnrollmentAction(idle)).resolves.toEqual({
      enrollment: { factorId, qrCode, secret },
      message: nlBE.managerMfa.enrollmentReady,
      status: "ready",
    });
    expect(mocks.enroll).toHaveBeenCalledExactlyOnceWith({
      factorType: "totp",
      friendlyName: "Cloxa manager",
      issuer: "Cloxa",
    });
  });

  it("does not enroll outside the authoritative setup state", async () => {
    mocks.getAuthContext.mockResolvedValue(readyContext);
    await expect(startManagerMfaEnrollmentAction(idle)).resolves.toEqual({
      message: nlBE.managerMfa.genericFailure,
      status: "error",
    });
    expect(mocks.enroll).not.toHaveBeenCalled();
  });

  it("verifies owned unverified factor before atomic registration", async () => {
    mocks.getAuthContext
      .mockResolvedValueOnce(setupContext)
      .mockResolvedValueOnce(readyContext);

    await expect(
      completeManagerMfaEnrollmentAction(
        idle,
        form({ factorId, code: "123456", returnTo: "/manager/team" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/manager/team");
    expect(mocks.listFactors).toHaveBeenCalledOnce();
    expect(mocks.challenge).toHaveBeenCalledExactlyOnceWith({ factorId });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({
      challengeId: "challenge-one",
      code: "123456",
      factorId,
    });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("register_manager_mfa");
    expect(mocks.verify.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.rpc.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects browser-selected or already verified factors", async () => {
    mocks.listFactors.mockResolvedValue({
      data: {
        all: [{ id: registeredFactorId, factor_type: "totp", status: "verified" }],
      },
      error: null,
    });
    await expect(
      completeManagerMfaEnrollmentAction(idle, form({ factorId, code: "123456" })),
    ).resolves.toEqual({ message: nlBE.managerMfa.genericFailure, status: "error" });
    expect(mocks.challenge).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("validates code and factor before creating a client", async () => {
    await expect(
      completeManagerMfaEnrollmentAction(idle, form({ factorId, code: "12345" })),
    ).resolves.toEqual({ message: nlBE.managerMfa.genericFailure, status: "error" });
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });
});

describe("manager TOTP verification", () => {
  it("challenges only the factor selected by database registration", async () => {
    mocks.getAuthContext
      .mockResolvedValueOnce({
        ...setupContext,
        state: "manager_mfa_verify",
        factorId: registeredFactorId,
      })
      .mockResolvedValueOnce(readyContext);

    await expect(
      verifyManagerMfaAction(
        idle,
        form({
          code: "654321",
          factorId,
          returnTo: "/manager/exports-v2",
        }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/manager/exports-v2");
    expect(mocks.challenge).toHaveBeenCalledExactlyOnceWith({
      factorId: registeredFactorId,
    });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith({
      challengeId: "challenge-one",
      code: "654321",
      factorId: registeredFactorId,
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("defaults unsafe return destinations to manager workspace", async () => {
    mocks.getAuthContext
      .mockResolvedValueOnce({
        ...setupContext,
        state: "manager_mfa_verify",
        factorId: registeredFactorId,
      })
      .mockResolvedValueOnce(readyContext);

    await expect(
      verifyManagerMfaAction(
        idle,
        form({ code: "654321", returnTo: "https://attacker.test" }),
      ),
    ).rejects.toThrow("NEXT_REDIRECT:/manager");
  });

  it.each(["context", "challenge", "verify", "refresh"])(
    "returns one generic failure when %s fails",
    async (stage) => {
      mocks.getAuthContext
        .mockResolvedValueOnce(
          stage === "context"
            ? setupContext
            : {
                ...setupContext,
                state: "manager_mfa_verify",
                factorId: registeredFactorId,
              },
        )
        .mockResolvedValueOnce(stage === "refresh" ? setupContext : readyContext);
      if (stage === "challenge") {
        mocks.challenge.mockResolvedValue({
          data: null,
          error: { message: "private" },
        });
      }
      if (stage === "verify") {
        mocks.verify.mockResolvedValue({ data: null, error: { message: "private" } });
      }

      await expect(
        verifyManagerMfaAction(idle, form({ code: "654321" })),
      ).resolves.toEqual({ message: nlBE.managerMfa.genericFailure, status: "error" });
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
});
