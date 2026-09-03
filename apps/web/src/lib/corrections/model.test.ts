import { describe, expect, it } from "vitest";

import { parseEmployeeCorrectionsView } from "@/lib/corrections/model";

const valid = {
  entries: [
    {
      ended_at: "2026-08-10T10:00:00.000Z",
      id: "10000000-0000-4000-8000-000000000001",
      started_at: "2026-08-10T08:00:00.000Z",
      worksite_id: "20000000-0000-4000-8000-000000000001",
    },
  ],
  requests: [
    {
      created_at: "2026-08-11T12:00:00.000Z",
      employee_reason: "Starttijd was onjuist.",
      id: "30000000-0000-4000-8000-000000000001",
      proposed_ended_at: "2026-08-10T10:00:00.000Z",
      proposed_started_at: "2026-08-10T08:15:00.000Z",
      request_kind: "adjustment",
      status: "pending",
      target_time_entry_id: "10000000-0000-4000-8000-000000000001",
      withdrawn_at: null,
      manager_note: null,
      resolved_at: null,
      applied_time_entry_id: null,
    },
  ],
  server_time: "2026-08-12T08:00:00.000Z",
  timezone: "Europe/Brussels",
};

describe("employee correction RPC model", () => {
  it("preserves strict chronology below millisecond precision", () => {
    const request = {
      ...valid.requests[0],
      proposed_started_at: "2026-08-10T08:15:00.000001Z",
      proposed_ended_at: "2026-08-10T08:15:00.000002Z",
    };
    expect(
      parseEmployeeCorrectionsView({ ...valid, requests: [request] }),
    ).not.toBeNull();
    expect(
      parseEmployeeCorrectionsView({
        ...valid,
        requests: [{ ...request, proposed_ended_at: request.proposed_started_at }],
      }),
    ).toBeNull();
  });
  it("maps closed entries and own request history", () => {
    expect(parseEmployeeCorrectionsView(valid)).toEqual({
      entries: [
        {
          endedAt: valid.entries[0]!.ended_at,
          id: valid.entries[0]!.id,
          startedAt: valid.entries[0]!.started_at,
          worksiteId: valid.entries[0]!.worksite_id,
        },
      ],
      requests: [
        {
          createdAt: valid.requests[0]!.created_at,
          employeeReason: valid.requests[0]!.employee_reason,
          id: valid.requests[0]!.id,
          proposedEndedAt: valid.requests[0]!.proposed_ended_at,
          proposedStartedAt: valid.requests[0]!.proposed_started_at,
          requestKind: "adjustment",
          status: "pending",
          targetTimeEntryId: valid.requests[0]!.target_time_entry_id,
          withdrawnAt: null,
          managerNote: null,
          resolvedAt: null,
          appliedTimeEntryId: null,
        },
      ],
      serverTime: valid.server_time,
      timezone: "Europe/Brussels",
    });
  });

  it.each([
    null,
    {},
    { ...valid, timezone: "UTC" },
    { ...valid, server_time: "bad" },
    { ...valid, server_time: "2026-08-12T08:00:00" },
    { ...valid, entries: [{ ...valid.entries[0], ended_at: null }] },
    {
      ...valid,
      requests: [{ ...valid.requests[0], proposed_ended_at: "2026-08-10T08:00Z" }],
    },
    {
      ...valid,
      requests: [{ ...valid.requests[0], request_kind: "missed_entry" }],
    },
    {
      ...valid,
      requests: [{ ...valid.requests[0], status: "withdrawn", withdrawn_at: null }],
    },
  ])("rejects malformed or inconsistent response %#", (value) => {
    expect(parseEmployeeCorrectionsView(value)).toBeNull();
  });
});
