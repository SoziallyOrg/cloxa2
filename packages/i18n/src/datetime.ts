const BRUSSELS_TIME_ZONE = "Europe/Brussels";
const LOCALE = "nl-BE";

/** Format a UTC instant as a Brussels wall-clock time, e.g. "14:05". */
export function formatBrusselsTime(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: BRUSSELS_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Format a UTC instant as a Brussels calendar date, e.g. "27 september 2026". */
export function formatBrusselsDate(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: BRUSSELS_TIME_ZONE,
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

/** Format a UTC instant as a short Brussels day label, e.g. "ma 28 sep". */
export function formatBrusselsShortDate(date: Date): string {
  return new Intl.DateTimeFormat(LOCALE, {
    timeZone: BRUSSELS_TIME_ZONE,
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(date)
    .replace(/\./g, "");
}
