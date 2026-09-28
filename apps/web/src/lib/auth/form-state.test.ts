import { describe, expect, it } from "vitest";

import { groupSecret, parseSixDigitCode } from "./form-state";

describe("parseSixDigitCode", () => {
  it("accepts six digits, with spaces people paste", () => {
    expect(parseSixDigitCode("123456")).toBe("123456");
    expect(parseSixDigitCode(" 123 456 ")).toBe("123456");
  });

  it("refuses anything else", () => {
    expect(parseSixDigitCode("12345")).toBeNull();
    expect(parseSixDigitCode("1234567")).toBeNull();
    expect(parseSixDigitCode("12a456")).toBeNull();
    expect(parseSixDigitCode(null)).toBeNull();
  });
});

describe("groupSecret", () => {
  it("groups by four for manual entry", () => {
    expect(groupSecret("ABCDEFGHIJ")).toBe("ABCD EFGH IJ");
    expect(groupSecret("")).toBe("");
  });
});
