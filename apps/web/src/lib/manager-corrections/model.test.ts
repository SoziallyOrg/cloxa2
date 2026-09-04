import { describe, expect, it } from "vitest";
import { parseManagerCorrectionsView } from "@/lib/manager-corrections/model";
import { parseCorrectionRequest } from "@/lib/corrections/model";

const id = "30000000-0000-4000-8000-000000000001";
const entryId = "40000000-0000-4000-8000-000000000001";
export const requestFixture = {
  id,
  breaks: [],
  request_kind: "adjustment",
  target_time_entry_id: entryId,
  employee_display_name: "Fictieve medewerker",
  employee_code: "SYN-1",
  employee_reason: "<script>employee text</script>",
  original_started_at: "2010-01-01T08:00:00.123456Z",
  original_ended_at: "2010-01-01T10:00:00Z",
  proposed_started_at: "2010-01-01T08:15:00.123456Z",
  proposed_ended_at: "2010-01-01T10:00:00Z",
  created_at: "2010-01-02T10:00:00Z",
  withdrawn_at: null,
  resolved_at: null,
  manager_note: null,
  applied_time_entry_id: null,
  status: "pending",
};
const view = {
  requests: [requestFixture],
  pending_count: 1,
  server_time: "2010-01-03T10:00:00Z",
  timezone: "Europe/Brussels",
};

describe("manager correction response boundary", () => {
  it("maps exact proposal and original facts, retaining text as text", () => {
    const parsed = parseManagerCorrectionsView(view)!;
    expect(parsed.pendingCount).toBe(1);
    expect(parsed.requests[0]).toMatchObject({
      employeeReason: requestFixture.employee_reason,
      originalStartedAt: requestFixture.original_started_at,
      proposedStartedAt: requestFixture.proposed_started_at,
    });
  });
  it("supports empty queue", () => {
    expect(
      parseManagerCorrectionsView({ ...view, requests: [], pending_count: 0 }),
    ).toEqual({ requests: [], pendingCount: 0 });
  });
  it.each(["approved", "rejected", "withdrawn"])(
    "maps terminal %s status with consistent resolution",
    (status) => {
      const request = {
        ...requestFixture,
        status,
        resolved_at: status === "withdrawn" ? null : "2010-01-03T10:00:00Z",
        withdrawn_at: status === "withdrawn" ? "2010-01-03T10:00:00Z" : null,
        manager_note: status === "rejected" ? "<b>Manager text</b>" : null,
        applied_time_entry_id: status === "approved" ? entryId : null,
      };
      expect(
        parseManagerCorrectionsView({ ...view, requests: [request], pending_count: 0 })
          ?.requests[0]?.status,
      ).toBe(status);
      const employee = parseCorrectionRequest({
        ...request,
        resolved_by_membership_id: "internal-manager",
        resolution_request_id: "internal-operation",
      });
      expect(employee).not.toHaveProperty("resolved_by_membership_id");
      expect(employee).not.toHaveProperty("resolution_request_id");
    },
  );
  it.each([
    null,
    {},
    { ...view, pending_count: 0 },
    { ...view, pending_count: -1 },
    { ...view, requests: [requestFixture, requestFixture], pending_count: 2 },
    { ...view, timezone: "UTC" },
    { ...view, server_time: "invalid" },
    ...[
      { original_started_at: null },
      { original_ended_at: "2010-01-01T07:00:00Z" },
      { proposed_ended_at: requestFixture.proposed_started_at },
      { request_kind: "missed_entry" },
      { employee_code: 42 },
      { employee_display_name: {} },
      { status: "unknown" },
      { manager_note: "pending note" },
      { applied_time_entry_id: entryId },
      { resolved_at: "2010-01-03T10:00:00Z" },
      { status: "approved" },
      { status: "rejected", resolved_at: "2010-01-03T10:00:00Z" },
      { status: "rejected", resolved_at: "2010-01-03T10:00:00Z", manager_note: " " },
      {
        status: "rejected",
        resolved_at: "2010-01-03T10:00:00Z",
        manager_note: "x".repeat(501),
      },
    ].map((fields) => ({ ...view, requests: [{ ...requestFixture, ...fields }] })),
  ])("fails closed for malformed queue %#", (value) => {
    expect(parseManagerCorrectionsView(value)).toBeNull();
  });
});
