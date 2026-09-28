import { RpcError } from "@cloxa/db";
import { describe, expect, it } from "vitest";

import { mapVerifyChainsError, toVerifyChainsResult } from "./verify";

describe("toVerifyChainsResult", () => {
  it("is ok when both broken ids are null", () => {
    expect(
      toVerifyChainsResult({ clock_broken_event_id: null, audit_broken_row_id: null }),
    ).toEqual({ ok: true });
  });

  it("carries the first broken clock event", () => {
    expect(
      toVerifyChainsResult({
        clock_broken_event_id: "event-1",
        audit_broken_row_id: null,
      }),
    ).toEqual({ ok: false, clockBrokenEventId: "event-1", auditBrokenRowId: null });
  });

  it("carries the first broken audit row", () => {
    expect(
      toVerifyChainsResult({
        clock_broken_event_id: null,
        audit_broken_row_id: "row-1",
      }),
    ).toEqual({ ok: false, clockBrokenEventId: null, auditBrokenRowId: "row-1" });
  });
});

describe("mapVerifyChainsError", () => {
  it("maps a 42501 refusal to the owner-only key", () => {
    const error = new RpcError("rpc_verify_chains", {
      message: "not_authorized",
      code: "42501",
    });
    expect(mapVerifyChainsError(error)).toBe("audit.verifyOwnerOnly");
  });

  it("maps anything else to the generic error key", () => {
    expect(mapVerifyChainsError(new Error("boom"))).toBe("audit.verifyError");
  });
});
