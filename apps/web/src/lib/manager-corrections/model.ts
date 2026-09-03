import {
  isRecord,
  isTimestamp,
  microseconds,
  parseCorrectionRequest,
  type EmployeeCorrectionRequest,
} from "@/lib/corrections/model";
import { BELGIUM_TIME_ZONE } from "@/lib/time-clock/model";

export type ManagerCorrectionRequest = EmployeeCorrectionRequest & {
  employeeCode: string | null;
  employeeDisplayName: string | null;
  originalStartedAt: string | null;
  originalEndedAt: string | null;
};
export type ManagerCorrectionsView = {
  pendingCount: number;
  requests: ManagerCorrectionRequest[];
};
export type DecisionActionState = {
  status: "idle" | "success" | "error";
  message: string;
  noteError?: string;
};

export function parseManagerCorrectionsView(
  value: unknown,
): ManagerCorrectionsView | null {
  if (
    !isRecord(value) ||
    value.timezone !== BELGIUM_TIME_ZONE ||
    !isTimestamp(value.server_time) ||
    !Number.isSafeInteger(value.pending_count) ||
    (value.pending_count as number) < 0 ||
    !Array.isArray(value.requests)
  )
    return null;
  const requests: ManagerCorrectionRequest[] = [];
  for (const item of value.requests) {
    const request = parseCorrectionRequest(item);
    if (
      !request ||
      !isRecord(item) ||
      !(
        item.employee_display_name === null ||
        typeof item.employee_display_name === "string"
      ) ||
      !(item.employee_code === null || typeof item.employee_code === "string")
    )
      return null;
    if (request.requestKind === "adjustment") {
      if (
        !isTimestamp(item.original_started_at) ||
        !isTimestamp(item.original_ended_at) ||
        microseconds(item.original_ended_at) < microseconds(item.original_started_at)
      )
        return null;
    } else if (item.original_started_at !== null || item.original_ended_at !== null)
      return null;
    requests.push({
      ...request,
      employeeCode: item.employee_code,
      employeeDisplayName: item.employee_display_name,
      originalStartedAt: item.original_started_at as string | null,
      originalEndedAt: item.original_ended_at as string | null,
    });
  }
  if (
    requests.filter((request) => request.status === "pending").length !==
      value.pending_count ||
    new Set(requests.map((request) => request.id)).size !== requests.length
  )
    return null;
  return { pendingCount: value.pending_count as number, requests };
}
