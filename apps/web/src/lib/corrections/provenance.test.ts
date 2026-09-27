import { beforeEach, expect, it, vi } from "vitest";
import { appliedDecision } from "./provenance";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  breaks: vi.fn(),
  from: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/break-corrections/server", () => ({
  getBreakCorrections: mocks.breaks,
}));
import { getEmployeeProvenance } from "./provenance-server";
const entryId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000001";
const revisionId = "30000000-0000-4000-8000-000000000001";
const breakId = "40000000-0000-4000-8000-000000000001";
const startedAt = "2026-09-04T06:00:12.123456Z",
  endedAt = "2026-09-04T14:00:09.123456Z";
const request = {
  id: requestId,
  status: "approved",
  request_kind: "adjustment",
  applied_time_entry_id: entryId,
  proposed_started_at: startedAt,
  proposed_ended_at: endedAt,
  employee_reason: "Fictieve reden",
  manager_note: "Nagekeken",
};
let rows: Record<string, unknown[]>;
const queries: { table: string; columns: string; field: string; ids: string[] }[] = [];
beforeEach(() => {
  vi.resetAllMocks();
  queries.length = 0;
  mocks.auth.mockResolvedValue({ state: "authorized", role: "employee" });
  mocks.client.mockResolvedValue({ from: mocks.from });
  mocks.breaks.mockResolvedValue({
    entries: [{ id: entryId, breaks: [{ revision_id: revisionId }] }],
    requests: [],
  });
  rows = {
    time_entries: [
      {
        id: entryId,
        started_at: startedAt,
        ended_at: endedAt,
        origin: "clock",
        last_correction_request_id: requestId,
      },
    ],
    correction_requests: [request],
    break_correction_requests: [
      { ...request, id: breakId, applied_revision_id: revisionId },
    ],
  };
  mocks.from.mockImplementation((table: string) => ({
    select: (columns: string) => ({
      in: (field: string, ids: string[]) => {
        queries.push({ table, columns, field, ids });
        return Promise.resolve({ data: rows[table], error: null });
      },
    }),
  }));
});
it.each(["pending", "rejected", "withdrawn"])(
  "%s never proves factual application even with forged application IDs",
  (status) => {
    expect(
      appliedDecision(
        { ...request, status },
        { id: requestId, appliedId: entryId, category: "time" },
      ),
    ).toBeNull();
  },
);
it("requires both exact request pointer and application target", () => {
  expect(
    appliedDecision(request, { id: breakId, appliedId: entryId, category: "time" }),
  ).toBeNull();
  expect(
    appliedDecision(request, {
      id: requestId,
      appliedId: revisionId,
      category: "time",
    }),
  ).toBeNull();
  expect(
    appliedDecision(request, { id: requestId, appliedId: entryId, category: "time" })
      ?.id,
  ).toBe(requestId);
});
it("reads referenced decisions directly, independent of truncated recent request history", async () => {
  const result = await getEmployeeProvenance([{ id: entryId, startedAt, endedAt }]);
  expect(result?.[entryId]?.decisions.map((d) => d.category)).toEqual([
    "time",
    "break",
  ]);
  expect(queries.find((q) => q.table === "correction_requests")).toMatchObject({
    field: "id",
    ids: [requestId],
  });
  expect(queries.find((q) => q.table === "break_correction_requests")).toMatchObject({
    field: "applied_revision_id",
    ids: [revisionId],
  });
  expect(
    queries.every((q) => !q.columns.includes("*") && !q.columns.includes("decided_by")),
  ).toBe(true);
});
it("distinguishes immutable added origin after a later adjustment", async () => {
  rows.time_entries![0] = {
    ...(rows.time_entries![0] as object),
    origin: "approved_missed_entry",
  };
  const result = await getEmployeeProvenance([{ id: entryId, startedAt, endedAt }]);
  expect(result?.[entryId]?.added).toBe(true);
  expect(result?.[entryId]?.decisions[0]?.kind).toBe("adjustment");
});
it("does not invent history from newer versions or absent pointers", async () => {
  rows.time_entries![0] = {
    ...(rows.time_entries![0] as object),
    last_correction_request_id: null,
    version: 99,
  };
  mocks.breaks.mockResolvedValue({ entries: [], requests: [request] });
  expect(
    (await getEmployeeProvenance([{ id: entryId, startedAt, endedAt }]))?.[entryId],
  ).toEqual({ added: false, decisions: [] });
});
it("hides provenance when source snapshot changed or read fails", async () => {
  expect(
    await getEmployeeProvenance([
      { id: entryId, startedAt, endedAt: "2026-09-04T14:00:09.123457Z" },
    ]),
  ).toEqual({});
  mocks.breaks.mockResolvedValue(null);
  expect(await getEmployeeProvenance([{ id: entryId, startedAt, endedAt }])).toBeNull();
});
it("does not read employee history for another role or after logout", async () => {
  mocks.auth.mockResolvedValue({ state: "anonymous" });
  expect(await getEmployeeProvenance([{ id: entryId, startedAt, endedAt }])).toBeNull();
  expect(mocks.from).not.toHaveBeenCalled();
});
