/**
 * Kiosk PIN rules, mirroring `private.pin_problem` in the database (which has
 * the last word): 4 to 6 digits, not all the same digit and not a straight
 * run up or down (1234, 6543, 012345). No `@cloxa/db` import: client forms
 * use this too.
 */
import type { CatalogKey } from "@cloxa/i18n";

export type PinProblem = "pin_invalid_format" | "pin_too_simple";

/** What the PIN forms' server actions answer. */
export interface PinActionResult {
  readonly ok: boolean;
  readonly errorKey?: CatalogKey;
}

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

export function pinProblem(pin: string): PinProblem | null {
  if (!/^[0-9]{4,6}$/.test(pin)) return "pin_invalid_format";

  const digits = [...pin].map(Number);
  let up = true;
  let down = true;
  for (let index = 1; index < digits.length; index += 1) {
    up &&= digits[index] === digits[index - 1]! + 1;
    down &&= digits[index] === digits[index - 1]! - 1;
  }
  const allSame = digits.every((digit) => digit === digits[0]);

  return up || down || allSame ? "pin_too_simple" : null;
}

export type PinFormProblem = PinProblem | "pin_mismatch";

/** PIN plus confirmation, as typed in the settings forms. */
export function pinFormProblem(
  pin: string,
  confirmation: string,
): PinFormProblem | null {
  const problem = pinProblem(pin);
  if (problem) return problem;
  return pin === confirmation ? null : "pin_mismatch";
}

/** A PIN problem code (from the form or the database) as copy. */
export function pinProblemKey(code: string): CatalogKey {
  switch (code) {
    case "pin_invalid_format":
      return "kiosk.pinErrorFormat";
    case "pin_too_simple":
      return "kiosk.pinErrorSimple";
    case "pin_mismatch":
      return "kiosk.pinErrorMismatch";
    case "not_authorized":
    case "employee_inactive":
      return "kiosk.pinErrorNotAllowed";
    default:
      return "kiosk.pinErrorGeneric";
  }
}
