import { describe, expect, it } from "vitest";

import { pinFormProblem, pinProblem } from "./pin";

// The same cases as supabase/tests/kiosk.test.sql, so both sides agree.
describe("pinProblem", () => {
  it.each(["1234", "4321", "0000", "123456", "987654", "0123", "99999"])(
    "refuses the trivial PIN %s",
    (pin) => {
      expect(pinProblem(pin)).toBe("pin_too_simple");
    },
  );

  it.each(["2580", "1357", "9012", "1243", "102030"])("accepts %s", (pin) => {
    expect(pinProblem(pin)).toBeNull();
  });

  it.each(["123", "1234567", "12a4", "", " 1234", "١٢٣٤"])(
    "refuses the malformed PIN %j",
    (pin) => {
      expect(pinProblem(pin)).toBe("pin_invalid_format");
    },
  );
});

describe("pinFormProblem", () => {
  it("needs the confirmation to match", () => {
    expect(pinFormProblem("2580", "2581")).toBe("pin_mismatch");
    expect(pinFormProblem("2580", "2580")).toBeNull();
  });

  it("reports the PIN's own problem first", () => {
    expect(pinFormProblem("1111", "2222")).toBe("pin_too_simple");
  });
});
