import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";

import { exportFormSchema, mapExportError, resolveExportScope } from "./form";

const A = "20000000-0000-4000-8000-0000000000a1";
const B = "20000000-0000-4000-8000-0000000000a2";
const C = "20000000-0000-4000-8000-0000000000a3";

describe("exportFormSchema", () => {
  it("accepts up to 62 days and refuses more or an inverted period", () => {
    const base = { siteIds: [A] };
    expect(
      exportFormSchema.safeParse({ ...base, from: "2026-09-01", to: "2026-11-01" })
        .success,
    ).toBe(true);
    expect(
      exportFormSchema.safeParse({ ...base, from: "2026-09-01", to: "2026-11-02" })
        .success,
    ).toBe(false);
    expect(
      exportFormSchema.safeParse({ ...base, from: "2026-09-02", to: "2026-09-01" })
        .success,
    ).toBe(false);
    expect(
      exportFormSchema.safeParse({ siteIds: [], from: "2026-09-01", to: "2026-09-01" })
        .success,
    ).toBe(false);
  });
});

describe("resolveExportScope", () => {
  it("turns every site into the whole organization for owners and admins", () => {
    expect(resolveExportScope("owner", [A, B], [B, A])).toEqual({
      ok: true,
      siteIds: null,
    });
    expect(resolveExportScope("admin", [A, B], [A])).toEqual({
      ok: true,
      siteIds: [A],
    });
  });

  it("keeps a manager's pick explicit, sorted and distinct", () => {
    expect(resolveExportScope("manager", [B, A], [B, A, B])).toEqual({
      ok: true,
      siteIds: [A, B],
    });
  });

  it("refuses sites outside reach and empty picks", () => {
    expect(resolveExportScope("manager", [A], [A, C])).toEqual({ ok: false });
    expect(resolveExportScope("owner", [A], [])).toEqual({ ok: false });
  });
});

describe("mapExportError", () => {
  it("maps database refusals to copy keys", () => {
    const rpc = (message: string, code = "22023") =>
      new RpcError("rpc_create_export", { message, code });
    expect(mapExportError(rpc("site_not_visible", "42501"))).toBe("exports.errorSites");
    expect(mapExportError(rpc("content_too_large"))).toBe("exports.errorTooLarge");
    expect(mapExportError(rpc("invalid_period"))).toBe("exports.errorPeriod");
    expect(mapExportError(rpc("row_not_visible", "42501"))).toBe(
      "exports.errorGeneric",
    );
    expect(mapExportError(new Error("too_many_events"))).toBe("exports.errorTooLarge");
  });
});
