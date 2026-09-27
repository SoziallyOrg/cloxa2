import { toBrusselsLocalInput } from "./format";

export type Occurrence = "" | "earlier" | "later";
export const minuteInput = (instant: string) =>
  toBrusselsLocalInput(instant).slice(0, 16);

/** Presentation aid only. The database resolver remains authoritative. */
export function localTimeCandidates(value: string): number[] | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/u.exec(value);
  if (!match) return null;
  const [, day, month, year, hour, minute] = match.map(Number);
  const wall = Date.UTC(year!, month! - 1, day!, hour!, minute!);
  const date = new Date(wall);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month! - 1 ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute
  )
    return null;
  // Discover offsets around this date using installed IANA rules, not transition dates.
  const offsets = new Set<number>();
  for (const delta of [-36, 0, 36]) {
    const sample = wall + delta * 3_600_000;
    const parts = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/u.exec(
      minuteInput(new Date(sample).toISOString()),
    )!;
    offsets.add(
      Date.UTC(+parts[3]!, +parts[2]! - 1, +parts[1]!, +parts[4]!, +parts[5]!) - sample,
    );
  }
  return [...offsets]
    .map((offset) => wall - offset)
    .filter((instant) => minuteInput(new Date(instant).toISOString()) === value)
    .sort((a, b) => a - b);
}

export function knownOccurrence(instant: string): Occurrence {
  const candidates = localTimeCandidates(minuteInput(instant));
  if (!candidates || candidates.length !== 2) return "";
  return Math.floor(Date.parse(instant) / 60_000) * 60_000 === candidates[0]
    ? "earlier"
    : "later";
}

/** Client snapshot is only an equality guard; restored facts come from authorized reads. */
export function preserveEndpoint(
  value: string,
  occurrence: Occurrence,
  expected: string,
  current: string | undefined,
) {
  if (!expected) return { value, occurrence };
  if (
    !current ||
    current !== expected ||
    minuteInput(current) !== value ||
    knownOccurrence(current) !== occurrence
  ) {
    throw new Error(
      "De registratie is gewijzigd. Vernieuw de pagina en controleer je aanvraag.",
    );
  }
  return { value: toBrusselsLocalInput(current), occurrence: knownOccurrence(current) };
}
