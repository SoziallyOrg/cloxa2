import {
  exactMicroseconds,
  parseBreaks,
  validTimestamp,
  type TimeBreak,
} from "./breaks";
export const BELGIUM_TIME_ZONE = "Europe/Brussels";

export type TimeClockEntry = {
  breaks: TimeBreak[];
  endedAt: string | null;
  id: string;
  startedAt: string;
  worksiteId: string;
};

export type TimeClockView = {
  currentStartedAt: string | null;
  entries: TimeClockEntry[];
  serverTime: string;
  status: "working" | "not_working" | "on_break";
  timezone: typeof BELGIUM_TIME_ZONE;
  worksiteId: string;
};

export type TimeClockActionState = {
  message: string;
  requestId?: string;
  status: "idle" | "success" | "error";
};

export const initialTimeClockActionState: TimeClockActionState = {
  message: "",
  status: "idle",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isTimestamp(value: unknown): value is string {
  return validTimestamp(value);
}

function parseEntry(value: unknown): TimeClockEntry | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.worksite_id) ||
    !isTimestamp(value.started_at) ||
    !(value.ended_at === null || isTimestamp(value.ended_at))
  ) {
    return null;
  }

  if (
    value.ended_at !== null &&
    exactMicroseconds(value.ended_at) < exactMicroseconds(value.started_at)
  ) {
    return null;
  }

  const breaks = parseBreaks(value.breaks);
  if (
    !breaks ||
    breaks.some(
      (b) =>
        exactMicroseconds(b.startedAt) <
          exactMicroseconds(value.started_at as string) ||
        (value.ended_at !== null &&
          (b.endedAt === null ||
            exactMicroseconds(b.endedAt) >
              exactMicroseconds(value.ended_at as string))),
    )
  )
    return null;
  return {
    breaks,
    endedAt: value.ended_at,
    id: value.id,
    startedAt: value.started_at,
    worksiteId: value.worksite_id,
  };
}

/** Fail closed when an RPC response does not match the minimal UI contract. */
export function parseTimeClockView(value: unknown): TimeClockView | null {
  if (
    !isRecord(value) ||
    !["working", "not_working", "on_break"].includes(String(value.status)) ||
    value.timezone !== BELGIUM_TIME_ZONE ||
    !isUuid(value.worksite_id) ||
    !isTimestamp(value.server_time) ||
    !Array.isArray(value.entries) ||
    !(value.current_started_at === null || isTimestamp(value.current_started_at))
  ) {
    return null;
  }

  if (
    (value.status !== "not_working") !==
    (typeof value.current_started_at === "string")
  ) {
    return null;
  }

  const entries = value.entries.map(parseEntry);

  if (entries.some((entry) => entry === null)) {
    return null;
  }

  const openBreaks = entries
    .flatMap((entry) => entry!.breaks)
    .filter((b) => b.endedAt === null);
  if (
    (value.status === "on_break") !== (openBreaks.length === 1) ||
    openBreaks.length > 1
  )
    return null;
  return {
    currentStartedAt: value.current_started_at,
    entries: entries as TimeClockEntry[],
    serverTime: value.server_time,
    status: value.status as TimeClockView["status"],
    timezone: BELGIUM_TIME_ZONE,
    worksiteId: value.worksite_id,
  };
}

export function isRequestId(value: unknown): value is string {
  return isUuid(value);
}
