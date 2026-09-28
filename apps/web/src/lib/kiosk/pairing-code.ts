import { PAIRING_CODE_ALPHABET, PAIRING_CODE_LENGTH } from "@cloxa/db";

const CODE = new RegExp(`^[${PAIRING_CODE_ALPHABET}]{${PAIRING_CODE_LENGTH}}$`);

/**
 * What people type on the tablet, as the database expects it: uppercase,
 * without spaces or dashes. Null when it cannot be a pairing code (so the
 * database is not asked, and no failure is counted for a typo in length).
 */
export function normalizePairingCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return CODE.test(code) ? code : null;
}

/** `ABCD2345` → `ABCD-2345`: easier to read out and type over. */
export function formatPairingCode(code: string): string {
  const half = PAIRING_CODE_LENGTH / 2;
  return `${code.slice(0, half)}-${code.slice(half)}`;
}
