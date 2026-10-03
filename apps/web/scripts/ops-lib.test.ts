import { describe, expect, it } from "vitest";

import {
  confirmRefusal,
  hostConfirmationMatches,
  isLoopbackHost,
  needsHostConfirmation,
  parseOpsArgs,
  targetHost,
} from "./ops-lib.ts";

const ID = "7f1c6a52-4c1e-4a7e-9a55-3f7f1b2f0a01";

describe("parseOpsArgs", () => {
  it("reads requests", () => {
    expect(parseOpsArgs(["requests"])).toEqual({
      ok: true,
      command: { kind: "requests", envFile: null },
    });
  });

  it("reads activate with a site, in both flag styles, and --confirm anywhere", () => {
    const expected = {
      ok: true,
      command: {
        kind: "activate",
        id: ID,
        site: "Bakkerij Zon",
        confirm: true,
        envFile: null,
      },
    };
    expect(
      parseOpsArgs(["activate", ID, "--site", "Bakkerij Zon", "--confirm"]),
    ).toEqual(expected);
    expect(parseOpsArgs(["--confirm", "activate", ID, "--site=Bakkerij Zon"])).toEqual(
      expected,
    );
  });

  it("defaults to no site and no confirmation", () => {
    expect(parseOpsArgs(["activate", ID.toUpperCase()])).toEqual({
      ok: true,
      command: { kind: "activate", id: ID, site: null, confirm: false, envFile: null },
    });
  });

  it("reads reject and --env-file", () => {
    expect(
      parseOpsArgs(["reject", ID, "--confirm", "--env-file", "../prod.env"]),
    ).toEqual({
      ok: true,
      command: { kind: "reject", id: ID, confirm: true, envFile: "../prod.env" },
    });
  });

  it.each([
    [[], "Geen commando"],
    [["frobnicate"], "Onbekend commando"],
    [["activate"], "geldig aanvraag-id"],
    [["activate", "niet-een-uuid"], "geldig aanvraag-id"],
    [["reject", ID, "--site", "X"], "reject kent geen --site"],
    [["requests", ID], "geen argumenten"],
    [["requests", "--confirm"], "alleen --env-file"],
    [["activate", ID, "--site"], "--site heeft een waarde nodig"],
    [["activate", ID, "--site", "--confirm"], "--site heeft een waarde nodig"],
    [["activate", ID, "--confirm=ja"], "--confirm heeft geen waarde"],
    [["activate", ID, "--yolo"], "Onbekende optie"],
    [["activate", ID, "extra"], "Te veel argumenten"],
  ])("refuses %j", (argv, message) => {
    const result = parseOpsArgs(argv);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain(message);
  });
});

describe("confirmation guards", () => {
  it("refuses changes without --confirm, but lets a listing through", () => {
    expect(confirmRefusal({ kind: "requests", envFile: null })).toBeNull();
    expect(
      confirmRefusal({ kind: "reject", id: ID, confirm: false, envFile: null }),
    ).toContain("--confirm");
    expect(
      confirmRefusal({
        kind: "activate",
        id: ID,
        site: null,
        confirm: false,
        envFile: null,
      }),
    ).toContain("--confirm");
    expect(
      confirmRefusal({ kind: "reject", id: ID, confirm: true, envFile: null }),
    ).toBeNull();
  });

  it("treats only loopback as local", () => {
    for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "[::1]"]) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    for (const host of [
      "abc.supabase.co",
      "127.0.0.1.evil.test",
      "10.0.0.5",
      "0.0.0.0",
    ]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
    expect(needsHostConfirmation("http://127.0.0.1:54321")).toBe(false);
    expect(needsHostConfirmation("http://localhost:54321")).toBe(false);
    expect(needsHostConfirmation("https://abc.supabase.co")).toBe(true);
    expect(needsHostConfirmation("http://127.0.0.1.evil.test")).toBe(true);
    // An unreadable URL is never trusted as local.
    expect(needsHostConfirmation("niet een url")).toBe(true);
  });

  it("wants the exact host typed back", () => {
    const url = "https://abcd1234.supabase.co";
    expect(targetHost(url)).toBe("abcd1234.supabase.co");
    expect(hostConfirmationMatches("abcd1234.supabase.co", url)).toBe(true);
    expect(hostConfirmationMatches("  ABCD1234.supabase.co \n", url)).toBe(true);
    expect(hostConfirmationMatches("ja", url)).toBe(false);
    expect(hostConfirmationMatches("", url)).toBe(false);
    expect(hostConfirmationMatches("abcd1234.supabase.com", url)).toBe(false);
    expect(hostConfirmationMatches("anything", "niet een url")).toBe(false);
  });
});
