import { describe, expect, it } from "vitest";

import { parseTimeClockView } from "@/lib/time-clock/model";

const valid = {
  current_started_at: "2026-09-02T08:00:00.000Z",
  entries: [
    {
      ended_at: null,
      id: "10000000-0000-4000-8000-000000000001",
      started_at: "2026-09-02T08:00:00.000Z",
      worksite_id: "20000000-0000-4000-8000-000000000001",
    },
  ],
  server_time: "2026-09-02T08:01:00.000Z",
  status: "working",
  timezone: "Europe/Brussels",
  worksite_id: "20000000-0000-4000-8000-000000000001",
};

describe("time-clock RPC model", () => {
  it("maps a minimal trusted response", () => {
    expect(parseTimeClockView(valid)).toEqual({
      currentStartedAt: valid.current_started_at,
      entries: [
        {
          endedAt: null,
          id: valid.entries[0]!.id,
          startedAt: valid.entries[0]!.started_at,
          worksiteId: valid.entries[0]!.worksite_id,
        },
      ],
      serverTime: valid.server_time,
      status: "working",
      timezone: "Europe/Brussels",
      worksiteId: valid.worksite_id,
    });
  });

  it.each([
    null,
    {},
    { ...valid, status: "manager" },
    { ...valid, timezone: "UTC" },
    { ...valid, current_started_at: null },
    { ...valid, entries: [{ ...valid.entries[0], started_at: "not-a-date" }] },
    {
      ...valid,
      entries: [
        {
          ...valid.entries[0],
          ended_at: "2026-09-02T07:59:59.000Z",
        },
      ],
    },
  ])("rejects malformed or inconsistent response %#", (value) => {
    expect(parseTimeClockView(value)).toBeNull();
  });
});
