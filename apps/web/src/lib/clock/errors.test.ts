import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";

import { mapClockError, mapCorrectionError } from "./errors";

function rpcError(message: string, code = "P0001"): RpcError {
  return new RpcError("rpc_clock", { message, code });
}

describe("mapClockError", () => {
  it("maps an invalid transition", () => {
    expect(mapClockError(rpcError("invalid_transition"))).toBe(
      "clockErrors.invalidTransition",
    );
  });

  it("maps a missing site assignment", () => {
    expect(mapClockError(rpcError("site_not_assigned", "42501"))).toBe(
      "clockErrors.notAssigned",
    );
  });

  it("maps an unrecognised database error to the generic fallback", () => {
    expect(mapClockError(rpcError("idempotency_key_reused", "22023"))).toBe(
      "clockErrors.generic",
    );
  });

  it("maps a fetch failure to the network message", () => {
    expect(mapClockError(new TypeError("Failed to fetch"))).toBe("clockErrors.network");
  });

  it("maps anything else to the generic fallback", () => {
    expect(mapClockError(new Error("boom"))).toBe("clockErrors.generic");
    expect(mapClockError(undefined)).toBe("clockErrors.generic");
  });
});

describe("mapCorrectionError", () => {
  it("maps target age and proposed-time errors", () => {
    expect(mapCorrectionError(rpcError("target_too_old", "22023"))).toBe(
      "correctionForm.tooOld",
    );
    expect(mapCorrectionError(rpcError("proposed_time_too_old", "22023"))).toBe(
      "correctionForm.tooOld",
    );
    expect(mapCorrectionError(rpcError("proposed_time_in_future", "22023"))).toBe(
      "correctionForm.inFuture",
    );
  });

  it("maps a replay failure and the pending-request cap", () => {
    expect(mapCorrectionError(rpcError("invalid_sequence"))).toBe(
      "correctionForm.invalidSequence",
    );
    expect(mapCorrectionError(rpcError("too_many_pending"))).toBe(
      "correctionForm.tooManyPending",
    );
  });

  it("maps validation failures to a friendly validation message", () => {
    expect(mapCorrectionError(rpcError("invalid_proposal", "22023"))).toBe(
      "correctionForm.validationError",
    );
  });

  it("falls back to the generic message for anything else", () => {
    expect(mapCorrectionError(new Error("boom"))).toBe("correctionForm.genericError");
  });
});
