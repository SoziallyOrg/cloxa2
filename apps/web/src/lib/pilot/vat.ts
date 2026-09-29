/**
 * Belgian VAT / enterprise numbers. People type them every way: `BE 0403.019.261`,
 * `0403 019 261`, `403019261` (the leading zero dropped). Pure, so the form, its
 * tests and the operator tooling agree.
 */

/** `BE0403019261`, or null when the text can't be a Belgian number. */
export function normalizeBeVat(raw: string): string | null {
  const compact = raw.replace(/[\s.\-/]/g, "").toUpperCase();
  const digits = compact.startsWith("BE") ? compact.slice(2) : compact;
  if (!/^\d{9,10}$/.test(digits)) return null;
  return `BE${digits.padStart(10, "0")}`;
}

/**
 * `BE`, a 0 or 1, then nine digits; the last two are 97 minus the first eight
 * digits modulo 97 (the database repeats this check).
 */
export function isValidBeVat(vat: string): boolean {
  if (!/^BE[01]\d{9}$/.test(vat)) return false;
  const base = Number(vat.slice(2, 10));
  const check = Number(vat.slice(10, 12));
  return 97 - (base % 97) === check;
}

/** The normalised number when it is a valid Belgian one, else null. */
export function parseBeVat(raw: string): string | null {
  const vat = normalizeBeVat(raw);
  return vat !== null && isValidBeVat(vat) ? vat : null;
}
