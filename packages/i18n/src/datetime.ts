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

/** A Brussels weekday and date for page subtitles, e.g. "Maandag 28 september". */
export function formatBrusselsLongDay(date: Date): string {
  const text = new Intl.DateTimeFormat(LOCALE, {
    timeZone: BRUSSELS_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const OFFSET_PROBE_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: BRUSSELS_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** Minutes to add to a UTC instant to get the Brussels wall-clock reading. */
function brusselsOffsetMinutesAt(epochMs: number): number {
  const parts = OFFSET_PROBE_FORMATTER.formatToParts(new Date(epochMs));
  const map: Record<string, string> = {};
  for (const part of parts) map[part.type] = part.value;
  // Midnight sometimes formats as "24" with hour12: false; normalize to 0.
  const hour = map.hour === "24" ? 0 : Number(map.hour);
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    hour,
    Number(map.minute),
    Number(map.second),
  );
  return (asUtc - epochMs) / 60_000;
}

/**
 * Convert a Europe/Brussels wall-clock date (`YYYY-MM-DD`) and time
 * (`HH:mm`) into a UTC instant, DST included. Iterates to a fixed point of
 * (instant, offset); a local time that doesn't exist (spring-forward gap)
 * has no fixed point, so it resolves using the smaller (standard-time)
 * offset, which moves the result forward by the gap. A local time that
 * exists twice (autumn fall-back overlap) converges directly to the later,
 * standard-time occurrence because the initial guess already lands on the
 * post-transition side.
 */
export function brusselsLocalToInstant(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const naiveUtc = Date.UTC(
    year ?? 0,
    (month ?? 1) - 1,
    day ?? 1,
    hour ?? 0,
    minute ?? 0,
    0,
  );

  const offset1 = brusselsOffsetMinutesAt(naiveUtc);
  const candidate1 = naiveUtc - offset1 * 60_000;
  const offset2 = brusselsOffsetMinutesAt(candidate1);

  if (offset2 === offset1) return new Date(candidate1);

  // Gap: no fixed point. Use the smaller (standard-time) offset, which
  // pushes the instant past the transition, i.e. forward by the gap.
  const offset = Math.min(offset1, offset2);
  return new Date(naiveUtc - offset * 60_000);
}
