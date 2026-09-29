import { describe, expect, it } from "vitest";

import { moduleById } from "@cloxa/modules";
import { brusselsLocalToInstant } from "@cloxa/i18n";

import { clockEventFromRow } from "./events";
import { renderMessage, renderValue, viewModule } from "./message";

describe("renderMessage", () => {
  it("formats durations, times, days and months for nl-BE", () => {
    expect(renderValue({ durationMs: (41 * 60 + 30) * 60_000 })).toBe("41 u 30 min");
    expect(
      renderValue({ time: brusselsLocalToInstant("2026-09-28", "08:02").getTime() }),
    ).toBe("08:02");
    expect(renderValue({ day: "2026-09-28" })).toBe("ma 28 sep");
    expect(renderValue({ month: "2026-09" })).toBe("September 2026");
    expect(renderValue(7)).toBe(7);
  });

  it("fills a catalog message, never with a negative duration", () => {
    expect(
      renderMessage({
        key: "modules.student.remaining",
        values: { remaining: { durationMs: 42 * 3600_000 } },
      }),
    ).toBe("Nog 42 u van het contingent van 650 u (indicatief)");
    expect(
      renderMessage({ key: "modules.value", values: { value: { durationMs: -1 } } }),
    ).toBe("0 min");
  });

  it("renders a module view as plain text", () => {
    const view = viewModule(moduleById("telework"), {
      shifts: [],
      planned: [],
      period: { from: "2026-09-01", to: "2026-09-29", now: Date.now() },
      config: {},
      data: null,
      audience: "employee",
    });
    expect(view).toEqual({
      id: "telework",
      label: "Thuiswerk",
      counters: [
        {
          id: "telework.2026-09",
          display: "row",
          label: "September 2026",
          value: "0 thuis · 0 op de werkplek",
          progress: null,
          lines: [],
        },
      ],
      hints: [],
    });
  });
});

describe("clockEventFromRow", () => {
  it("keeps the work location, and only a known one", () => {
    const row = {
      id: "e1",
      type: "clock_in",
      occurred_at: "2026-09-28T06:00:00Z",
      employee_id: "p1",
      site_id: "s1",
      source: "app",
      supersedes_event_id: null,
      correction_id: null,
    };
    expect(clockEventFromRow({ ...row, work_location: "home" }).workLocation).toBe(
      "home",
    );
    expect(clockEventFromRow({ ...row, work_location: "garden" })).not.toHaveProperty(
      "workLocation",
    );
    expect(clockEventFromRow(row)).not.toHaveProperty("workLocation");
  });
});
