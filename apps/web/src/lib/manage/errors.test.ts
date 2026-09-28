import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";

import { mapDecideCorrectionError, mapInviteError } from "./errors";

function rpcError(message: string): RpcError {
  return new RpcError("rpc_decide_correction", { message, code: "P0001" });
}

describe("mapDecideCorrectionError", () => {
  it("maps invalid_sequence", () => {
    expect(mapDecideCorrectionError(rpcError("invalid_sequence"))).toBe(
      "manageVragen.errorInvalidSequence",
    );
  });

  it("maps self_decision_not_allowed", () => {
    expect(mapDecideCorrectionError(rpcError("self_decision_not_allowed"))).toBe(
      "manageVragen.errorSelfDecision",
    );
  });

  it("maps a stale target", () => {
    expect(mapDecideCorrectionError(rpcError("target_not_effective"))).toBe(
      "manageVragen.errorStale",
    );
    expect(mapDecideCorrectionError(rpcError("not_pending"))).toBe(
      "manageVragen.errorStale",
    );
  });

  it("falls back to a generic error for anything else, including non-RpcErrors", () => {
    expect(mapDecideCorrectionError(rpcError("something_else"))).toBe(
      "manageVragen.errorGeneric",
    );
    expect(mapDecideCorrectionError(new TypeError("network"))).toBe(
      "manageVragen.errorGeneric",
    );
  });
});

describe("mapInviteError", () => {
  it("maps a duplicate email", () => {
    expect(mapInviteError(rpcError("email_already_invited"))).toBe(
      "manageTeam.errorEmailInUse",
    );
  });

  it("maps an unmanaged site", () => {
    expect(mapInviteError(rpcError("site_not_managed"))).toBe(
      "manageTeam.errorSiteNotManaged",
    );
  });

  it("falls back to a generic error", () => {
    expect(mapInviteError(rpcError("anything"))).toBe("manageTeam.errorGeneric");
  });
});
