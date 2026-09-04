import { expect, it } from "vitest";
import {
  effectiveBreakSchema,
  parseBreakCorrectionResponse,
  parseBreakView,
  retireOperation,
  type BreakIntent,
} from "./model";
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const submitted = {
  request_id: id,
  result_code: "submitted",
  did_transition: true,
  correction_request_id: other,
  request_status: "pending",
  applied_revision_id: null,
};
it.each(["missed_break", "adjustment", "removal"] as BreakIntent[])(
  "parses %s submission",
  (intent) =>
    expect(parseBreakCorrectionResponse(submitted, id, intent)).not.toBeNull(),
);
it.each([
  null,
  [],
  {},
  { ...submitted, extra: 1 },
  { ...submitted, request_id: other },
  { ...submitted, request_id: "bad" },
  { ...submitted, did_transition: "true" },
  { ...submitted, did_transition: false },
  { ...submitted, result_code: "approved" },
  { ...submitted, request_status: "approved" },
  { ...submitted, applied_revision_id: id },
  { ...submitted, correction_request_id: null },
  { ...submitted, request_status: null },
])("rejects malformed response %#", (value) =>
  expect(parseBreakCorrectionResponse(value, id, "missed_break")).toBeNull(),
);
it.each(Object.keys(submitted))("requires key %s", (key) => {
  const value = { ...submitted } as Record<string, unknown>;
  delete value[key];
  expect(parseBreakCorrectionResponse(value, id, "missed_break")).toBeNull();
});
it.each([
  "closed_shift_required",
  "stale_request",
  "pending_time_correction",
  "pending_break_correction",
  "invalid_interval",
  "overlap",
  "unchanged",
])("validates safe blocker %s", (code) =>
  expect(
    parseBreakCorrectionResponse(
      {
        ...submitted,
        result_code: code,
        did_transition: false,
        correction_request_id: null,
        request_status: null,
      },
      id,
      "missed_break",
    ),
  ).not.toBeNull(),
);
it.each(["approve", "reject", "withdraw"] as BreakIntent[])(
  "terminal operation %s",
  (intent) => {
    const state =
      intent === "approve"
        ? "approved"
        : intent === "reject"
          ? "rejected"
          : "withdrawn";
    const result = {
      ...submitted,
      result_code: state,
      request_status: state,
      applied_revision_id: intent === "approve" ? id : null,
    };
    expect(parseBreakCorrectionResponse(result, id, intent, other)).not.toBeNull();
    expect(parseBreakCorrectionResponse(result, id, intent, id)).toBeNull();
  },
);
it("enforces operation compatibility", () => {
  expect(
    parseBreakCorrectionResponse(
      { ...submitted, result_code: "rejected", request_status: "rejected" },
      id,
      "approve",
      other,
    ),
  ).toBeNull();
  expect(
    parseBreakCorrectionResponse(
      { ...submitted, result_code: "already_terminal", did_transition: false },
      id,
      "withdraw",
      other,
    ),
  ).toBeNull();
});
it("retires only matching confirmed operation", () => {
  expect(retireOperation(id, id)).toBe("");
  expect(retireOperation(id)).toBe(id);
  expect(retireOperation(id, other)).toBe(id);
});
const pause = {
  logical_break_id: id,
  version: 3,
  revision_id: other,
  started_at: "2010-01-01T10:00:00.000001Z",
  ended_at: "2010-01-01T10:00:00.000002Z",
  removed: false,
  origin: "live",
};
it.each([
  { ...pause, version: 0 },
  { ...pause, version: 1.5 },
  { ...pause, started_at: "2010-02-30T10:00:00Z" },
  { ...pause, ended_at: pause.started_at },
  { ...pause, removed: true },
  { ...pause, revision_id: null },
  { ...pause, extra: 1 },
])("rejects invalid effective state %#", (p) =>
  expect(effectiveBreakSchema.safeParse(p).success).toBe(false),
);
it("accepts append-only revision and tombstone", () => {
  expect(effectiveBreakSchema.safeParse(pause).success).toBe(true);
  expect(
    effectiveBreakSchema.safeParse({
      ...pause,
      removed: true,
      started_at: null,
      ended_at: null,
    }).success,
  ).toBe(true);
});
it("validates own effective containment and request UUID", () => {
  const view = {
    request_id: id,
    requests: [],
    entries: [
      {
        id,
        organization_id: id,
        membership_id: id,
        worksite_id: id,
        started_at: "2010-01-01T09:00:00Z",
        ended_at: "2010-01-01T17:00:00Z",
        version: 2,
        breaks: [pause],
      },
    ],
  };
  expect(parseBreakView(view, id)).not.toBeNull();
  expect(parseBreakView(view, other)).toBeNull();
  expect(
    parseBreakView(
      { ...view, entries: [{ ...view.entries[0], ended_at: "2010-01-01T10:00:00Z" }] },
      id,
    ),
  ).toBeNull();
});
