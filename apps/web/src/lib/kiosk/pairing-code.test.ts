import { describe, expect, it } from "vitest";

import { PAIRING_CODE_ALPHABET } from "@cloxa/db";

import { formatPairingCode, normalizePairingCode } from "./pairing-code";

describe("pairing code", () => {
  it("uses 32 symbols without I, O, 0 or 1", () => {
    expect(new Set(PAIRING_CODE_ALPHABET).size).toBe(32);
    expect(PAIRING_CODE_ALPHABET).not.toMatch(/[IO01]/);
  });

  it("accepts a code typed in lowercase, with a dash or spaces", () => {
    expect(normalizePairingCode("abcd-2345")).toBe("ABCD2345");
    expect(normalizePairingCode(" AB CD 23 45 ")).toBe("ABCD2345");
  });

  it("refuses the wrong length and ambiguous characters", () => {
    expect(normalizePairingCode("ABCD234")).toBeNull();
    expect(normalizePairingCode("ABCD23456")).toBeNull();
    expect(normalizePairingCode("ABCD1O23")).toBeNull();
    expect(normalizePairingCode(null)).toBeNull();
  });

  it("formats in two groups of four", () => {
    expect(formatPairingCode("ABCD2345")).toBe("ABCD-2345");
  });
});
