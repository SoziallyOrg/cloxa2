import { describe, expect, it } from "vitest";

import { isValidBeVat, normalizeBeVat, parseBeVat } from "./vat";

describe("normalizeBeVat", () => {
  it.each([
    ["BE0403019261", "BE0403019261"],
    ["be 0403.019.261", "BE0403019261"],
    ["0403 019 261", "BE0403019261"],
    ["BE-0403-019-261", "BE0403019261"],
    // Numbers are often written without their leading zero.
    ["403.019.261", "BE0403019261"],
  ])("reads %s", (raw, expected) => {
    expect(normalizeBeVat(raw)).toBe(expected);
  });

  it.each(["", "BE", "NL0403019261", "BE04030192", "BE04030192611", "BE040301926a"])(
    "rejects %j",
    (raw) => {
      expect(normalizeBeVat(raw)).toBeNull();
    },
  );
});

describe("isValidBeVat", () => {
  it("accepts numbers whose check digits are 97 minus the base modulo 97", () => {
    expect(isValidBeVat("BE0403019261")).toBe(true);
    expect(isValidBeVat("BE0123456749")).toBe(true);
    // A 1-series number: 10000000 mod 97 = 76, so the check is 21.
    expect(isValidBeVat("BE1000000021")).toBe(true);
  });

  it("refuses a wrong check, a wrong shape or another leading digit", () => {
    expect(isValidBeVat("BE0403019262")).toBe(false);
    expect(isValidBeVat("BE0403019200")).toBe(false);
    expect(isValidBeVat("BE2403019261")).toBe(false);
    expect(isValidBeVat("0403019261")).toBe(false);
  });

  it("handles a base divisible by 97 (check 97) and a check of 01", () => {
    expect(isValidBeVat("BE0000000097")).toBe(true);
    // 00000096 mod 97 = 96, so the check is 01.
    expect(isValidBeVat("BE0000009601")).toBe(true);
  });
});

describe("parseBeVat", () => {
  it("normalises and validates in one go", () => {
    expect(parseBeVat(" be 0403.019.261 ")).toBe("BE0403019261");
    expect(parseBeVat("BE 0403.019.262")).toBeNull();
    expect(parseBeVat("hallo")).toBeNull();
  });
});
