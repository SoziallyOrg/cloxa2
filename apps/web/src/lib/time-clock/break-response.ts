import { exactMicroseconds } from "./breaks";
import { isRequestId } from "./model";

export type BreakOperation = "start_break" | "end_break";
const codes = [
  "started",
  "ended",
  "no_open_shift",
  "already_on_break",
  "no_open_break",
  "invalid_interval",
] as const;
type BreakCode = (typeof codes)[number];
const keys = [
  "request_id",
  "result_code",
  "did_transition",
  "break_id",
  "time_entry_id",
  "started_at",
  "ended_at",
  "version",
] as const;

// Reject calendar normalization, loose Date.parse inputs, and sub-microsecond precision.
export function timestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.exec(
      value,
    );
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]),
    month = Number(match[2]),
    day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return (
    year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0)
  );
}

export function parseBreakResponse(
  value: unknown,
  requestId: string,
  operation: BreakOperation,
): { resultCode: BreakCode; didTransition: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(row, key)) ||
    !isRequestId(row.request_id) ||
    row.request_id !== requestId ||
    !codes.includes(row.result_code as BreakCode)
  )
    return null;
  const code = row.result_code as BreakCode;
  const transition = code === "started" || code === "ended";
  if (row.did_transition !== transition) return null;
  const noBreak =
    row.break_id === null &&
    row.started_at === null &&
    row.ended_at === null &&
    row.version === null;
  const openBreak =
    isRequestId(row.break_id) &&
    isRequestId(row.time_entry_id) &&
    timestamp(row.started_at) &&
    row.ended_at === null &&
    row.version === 1;
  let valid = false;
  switch (code) {
    case "started":
      valid = operation === "start_break" && openBreak;
      break;
    case "ended":
      valid =
        operation === "end_break" &&
        isRequestId(row.break_id) &&
        isRequestId(row.time_entry_id) &&
        timestamp(row.started_at) &&
        timestamp(row.ended_at) &&
        row.version === 2 &&
        exactMicroseconds(row.ended_at) > exactMicroseconds(row.started_at);
      break;
    case "no_open_shift":
      valid = row.time_entry_id === null && noBreak;
      break;
    case "already_on_break":
      valid = operation === "start_break" && openBreak;
      break;
    case "no_open_break":
      valid = operation === "end_break" && isRequestId(row.time_entry_id) && noBreak;
      break;
    case "invalid_interval":
      valid =
        operation === "start_break"
          ? isRequestId(row.time_entry_id) && noBreak
          : openBreak;
      break;
  }
  return valid ? { resultCode: code, didTransition: transition } : null;
}
