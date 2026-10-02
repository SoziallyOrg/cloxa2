/**
 * Pure grouping for `loadRequests`: the queries are batched (one for all
 * targets, one events window per employee) and these helpers hand each
 * request its own slice again, so results match one query per request.
 */
export const DAY_MS = 24 * 3600 * 1000;

export interface BatchRequest {
  readonly id: string;
  readonly employeeId: string;
  readonly anchorMs: number;
}

export interface WindowEvent {
  readonly employee_id: string;
  readonly occurred_at: string;
}

/** The earliest target event's time, or null when none of the targets is known. */
export function earliestTargetMs(
  targetIds: readonly string[],
  occurredAtById: ReadonlyMap<string, string>,
): number | null {
  let earliest: number | null = null;
  for (const id of targetIds) {
    const iso = occurredAtById.get(id);
    if (iso === undefined) continue;
    const ms = Date.parse(iso);
    if (earliest === null || ms < earliest) earliest = ms;
  }
  return earliest;
}

/** Per employee, the span that covers every request's ±1 day window. */
export function windowsByEmployee(
  requests: readonly BatchRequest[],
): Map<string, { fromMs: number; toMs: number }> {
  const spans = new Map<string, { fromMs: number; toMs: number }>();
  for (const request of requests) {
    const fromMs = request.anchorMs - DAY_MS;
    const toMs = request.anchorMs + DAY_MS;
    const span = spans.get(request.employeeId);
    spans.set(
      request.employeeId,
      span
        ? { fromMs: Math.min(span.fromMs, fromMs), toMs: Math.max(span.toMs, toMs) }
        : { fromMs, toMs },
    );
  }
  return spans;
}

/** The events of one request's own window (inclusive on both ends), in input order. */
export function eventsInWindow<T extends WindowEvent>(
  events: readonly T[],
  request: Pick<BatchRequest, "employeeId" | "anchorMs">,
): T[] {
  const from = request.anchorMs - DAY_MS;
  const to = request.anchorMs + DAY_MS;
  return events.filter((event) => {
    if (event.employee_id !== request.employeeId) return false;
    const at = Date.parse(event.occurred_at);
    return at >= from && at <= to;
  });
}
