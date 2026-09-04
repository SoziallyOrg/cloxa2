export type TimeBreak = {
  id: string;
  startedAt: string;
  endedAt: string | null;
  version: number;
};

/** Integer epoch microseconds. Date parses only the integral millisecond portion. */
export function exactMicroseconds(value: string) {
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/u.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3));
}

export function parseBreaks(value: unknown): TimeBreak[] | null {
  if (!Array.isArray(value)) return null;
  const result: TimeBreak[] = [];
  for (const item of value) {
    if (
      !item ||
      typeof item !== "object" ||
      typeof item.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        item.id,
      ) ||
      !validTimestamp(item.started_at) ||
      !(item.ended_at === null || validTimestamp(item.ended_at)) ||
      (item.ended_at === null
        ? item.version !== 1
        : !Number.isSafeInteger(item.version) || item.version < 1)
    )
      return null;
    if (
      item.ended_at !== null &&
      exactMicroseconds(item.ended_at) <= exactMicroseconds(item.started_at)
    )
      return null;
    const previous = result.at(-1);
    if (
      result.some((b) => b.id === item.id) ||
      (previous &&
        (previous.endedAt === null ||
          exactMicroseconds(previous.endedAt) > exactMicroseconds(item.started_at)))
    )
      return null;
    result.push({
      id: item.id,
      startedAt: item.started_at,
      endedAt: item.ended_at,
      version: item.version,
    });
  }
  return result;
}

export function validTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function factualTotals(start: string, end: string | null, breaks: TimeBreak[]) {
  const gross = end === null ? null : exactMicroseconds(end) - exactMicroseconds(start);
  const completedBreak = breaks.reduce(
    (sum, b) =>
      b.endedAt === null
        ? sum
        : sum + exactMicroseconds(b.endedAt) - exactMicroseconds(b.startedAt),
    0n,
  );
  return { gross, completedBreak, net: gross === null ? null : gross - completedBreak };
}

export function formatExactDuration(value: bigint) {
  const hours = value / 3_600_000_000n;
  const minutes = (value / 60_000_000n) % 60n;
  const seconds = (value / 1_000_000n) % 60n;
  const fraction = (value % 1_000_000n).toString().padStart(6, "0");
  return `${hours} u ${minutes.toString().padStart(2, "0")} min ${seconds.toString().padStart(2, "0")},${fraction} s`;
}
