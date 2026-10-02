import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";

import {
  decideErrorKey,
  decideReturnTo,
  mapDecideCorrectionError,
  mapInviteError,
  mapSetScheduleError,
} from "./errors";

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

describe("mapSetScheduleError", () => {
  it("maps an out-of-range valid_from", () => {
    expect(mapSetScheduleError(rpcError("invalid_valid_from"))).toBe(
      "schedule.errorInvalidValidFrom",
    );
  });

  it("maps an invalid pattern", () => {
    expect(mapSetScheduleError(rpcError("invalid_schedule_pattern"))).toBe(
      "schedule.errorInvalidPattern",
    );
  });

  it("maps not_authorized", () => {
    expect(mapSetScheduleError(rpcError("not_authorized"))).toBe(
      "schedule.errorNotAuthorized",
    );
  });

  it("falls back to a generic error", () => {
    expect(mapSetScheduleError(rpcError("anything"))).toBe("schedule.errorGeneric");
    expect(mapSetScheduleError(new TypeError("network"))).toBe("schedule.errorGeneric");
  });
});

describe("decideErrorKey", () => {
  it("accepts every key the decide actions can return", () => {
    for (const message of [
      "invalid_sequence",
      "self_decision_not_allowed",
      "not_pending",
      "whatever",
    ]) {
      const key = mapDecideCorrectionError(rpcError(message));
      expect(decideErrorKey(key)).toBe(key);
    }
    expect(decideErrorKey("manageVragen.rejectNoteRequired")).toBe(
      "manageVragen.rejectNoteRequired",
    );
  });

  it("drops anything else, including other catalog keys", () => {
    expect(decideErrorKey("manageVragen.nope")).toBeNull();
    expect(decideErrorKey("manageVragen.heading")).toBeNull();
    expect(decideErrorKey("")).toBeNull();
    expect(decideErrorKey(undefined)).toBeNull();
    expect(decideErrorKey(["manageVragen.errorStale"])).toBeNull();
  });
});

describe("decideReturnTo", () => {
  it("only knows vandaag, else aanvragen", () => {
    expect(decideReturnTo("vandaag")).toBe("vandaag");
    expect(decideReturnTo("aanvragen")).toBe("aanvragen");
    expect(decideReturnTo("https://evil.example")).toBe("aanvragen");
    expect(decideReturnTo(null)).toBe("aanvragen");
  });
});
