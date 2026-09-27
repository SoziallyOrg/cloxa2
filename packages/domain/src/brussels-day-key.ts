const BRUSSELS_DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Brussels",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The Europe/Brussels calendar day (`YYYY-MM-DD`) an epoch-millisecond
 * instant falls on, DST included. `en-CA` formats as `YYYY-MM-DD` without a
 * date library.
 */
export function brusselsDayKey(epochMs: number): string {
  return BRUSSELS_DAY_KEY_FORMATTER.format(new Date(epochMs));
}
