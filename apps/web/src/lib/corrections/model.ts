import { parseBreaks, type TimeBreak } from "@/lib/time-clock/breaks";
import { BELGIUM_TIME_ZONE } from "@/lib/time-clock/model";

export type CorrectionEntry = {
  breaks: TimeBreak[];
  endedAt: string;
  id: string;
  startedAt: string;
  worksiteId: string;
};

export type CorrectionRequestKind = "adjustment" | "missed_entry";
export type CorrectionRequestStatus = "pending" | "withdrawn" | "approved" | "rejected";

export type EmployeeCorrectionRequest = {
  breaks: TimeBreak[];
  appliedTimeEntryId: string | null;
  createdAt: string;
  employeeReason: string;
  id: string;
  managerNote: string | null;
  resolvedAt: string | null;
  proposedEndedAt: string;
  proposedStartedAt: string;
  requestKind: CorrectionRequestKind;
  status: CorrectionRequestStatus;
  targetTimeEntryId: string | null;
  withdrawnAt: string | null;
};

export type EmployeeCorrectionsView = {
  entries: CorrectionEntry[];
  requests: EmployeeCorrectionRequest[];
  serverTime: string;
  timezone: typeof BELGIUM_TIME_ZONE;
};

export type CorrectionField =
  | "employee_reason"
  | "proposed_end_local"
  | "proposed_start_local"
  | "proposed_start_occurrence"
  | "proposed_end_occurrence"
  | "target_time_entry_id";

export type CorrectionActionState = {
  fieldErrors?: Partial<Record<CorrectionField, string>>;
  message: string;
  requestId?: string;
  status: "idle" | "success" | "error";
};

export type WithdrawalActionState = {
  message: string;
  requestId?: string;
  status: "idle" | "success" | "error";
};

export const initialCorrectionActionState: CorrectionActionState = {
  message: "",
  status: "idle",
};

export const initialWithdrawalActionState: WithdrawalActionState = {
  message: "",
  status: "idle",
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

export function microseconds(value: string) {
  const fraction = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/u.exec(value)?.[1] ?? "";
  return BigInt(Date.parse(value)) * 1000n + BigInt(fraction.padEnd(6, "0").slice(3));
}

function parseEntry(value: unknown): CorrectionEntry | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    !isUuid(value.worksite_id) ||
    !isTimestamp(value.started_at) ||
    !isTimestamp(value.ended_at) ||
    microseconds(value.ended_at) < microseconds(value.started_at)
  ) {
    return null;
  }

  const breaks = parseBreaks(value.breaks);
  if (!breaks) return null;
  return {
    breaks,
    endedAt: value.ended_at,
    id: value.id,
    startedAt: value.started_at,
    worksiteId: value.worksite_id,
  };
}

export function parseCorrectionRequest(
  value: unknown,
): EmployeeCorrectionRequest | null {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    (value.request_kind !== "adjustment" && value.request_kind !== "missed_entry") ||
    !isTimestamp(value.proposed_started_at) ||
    !isTimestamp(value.proposed_ended_at) ||
    microseconds(value.proposed_ended_at) <= microseconds(value.proposed_started_at) ||
    typeof value.employee_reason !== "string" ||
    value.employee_reason.length < 1 ||
    [...value.employee_reason].length > 500 ||
    !["pending", "withdrawn", "approved", "rejected"].includes(String(value.status)) ||
    !isTimestamp(value.created_at) ||
    !(
      value.manager_note === null ||
      (typeof value.manager_note === "string" &&
        value.manager_note.trim().length > 0 &&
        [...value.manager_note].length <= 500)
    ) ||
    !(value.resolved_at === null || isTimestamp(value.resolved_at)) ||
    !(value.applied_time_entry_id === null || isUuid(value.applied_time_entry_id)) ||
    ["approved", "rejected"].includes(String(value.status)) !==
      (value.resolved_at !== null) ||
    (value.status === "approved") !== (value.applied_time_entry_id !== null) ||
    (value.status === "rejected" && value.manager_note === null) ||
    (["pending", "withdrawn"].includes(String(value.status)) &&
      value.manager_note !== null) ||
    !(value.withdrawn_at === null || isTimestamp(value.withdrawn_at)) ||
    !(value.target_time_entry_id === null || isUuid(value.target_time_entry_id)) ||
    (value.request_kind === "adjustment") !==
      (typeof value.target_time_entry_id === "string") ||
    (value.status === "withdrawn") !== (typeof value.withdrawn_at === "string")
  ) {
    return null;
  }

  const breaks = parseBreaks(value.breaks);
  if (!breaks) return null;
  return {
    breaks,
    appliedTimeEntryId: value.applied_time_entry_id,
    createdAt: value.created_at,
    employeeReason: value.employee_reason,
    id: value.id,
    managerNote: value.manager_note,
    resolvedAt: value.resolved_at,
    proposedEndedAt: value.proposed_ended_at,
    proposedStartedAt: value.proposed_started_at,
    requestKind: value.request_kind,
    status: value.status as CorrectionRequestStatus,
    targetTimeEntryId: value.target_time_entry_id,
    withdrawnAt: value.withdrawn_at,
  };
}

export function parseEmployeeCorrectionsView(
  value: unknown,
): EmployeeCorrectionsView | null {
  if (
    !isRecord(value) ||
    value.timezone !== BELGIUM_TIME_ZONE ||
    !isTimestamp(value.server_time) ||
    !Array.isArray(value.entries) ||
    !Array.isArray(value.requests)
  ) {
    return null;
  }

  const entries = value.entries.map(parseEntry);
  const requests = value.requests.map(parseCorrectionRequest);

  if (
    entries.some((entry) => entry === null) ||
    requests.some((request) => request === null)
  ) {
    return null;
  }

  return {
    entries: entries as CorrectionEntry[],
    requests: requests as EmployeeCorrectionRequest[],
    serverTime: value.server_time,
    timezone: BELGIUM_TIME_ZONE,
  };
}
