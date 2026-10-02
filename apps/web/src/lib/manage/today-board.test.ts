import { describe, expect, it } from "vitest";

import {
  activePanelTab,
  groupPeople,
  requestTiles,
  statusGroup,
  trackTone,
} from "./today-board";

describe("statusGroup", () => {
  it("puts attention before working or break", () => {
    expect(statusGroup({ open: true, onBreak: false, hasAttention: true })).toBe(
      "attention",
    );
    expect(statusGroup({ open: false, onBreak: false, hasAttention: true })).toBe(
      "attention",
    );
  });

  it("splits open shifts into working and break, the rest is idle", () => {
    expect(statusGroup({ open: true, onBreak: false, hasAttention: false })).toBe(
      "working",
    );
    expect(statusGroup({ open: true, onBreak: true, hasAttention: false })).toBe(
      "break",
    );
    expect(statusGroup({ open: false, onBreak: false, hasAttention: false })).toBe(
      "idle",
    );
  });
});

describe("trackTone", () => {
  it("is red only for an open shift that needs attention", () => {
    expect(trackTone({ open: true, hasAttention: true })).toBe("attention");
    expect(trackTone({ open: true, hasAttention: false })).toBe("working");
    expect(trackTone({ open: false, hasAttention: true })).toBe("done");
    expect(trackTone({ open: false, hasAttention: false })).toBe("done");
  });
});

describe("groupPeople", () => {
  it("orders the groups and drops empty ones", () => {
    const grouped = groupPeople([
      { id: "a", group: "idle" as const },
      { id: "b", group: "working" as const },
      { id: "c", group: "attention" as const },
      { id: "d", group: "working" as const },
    ]);
    expect(grouped.map((entry) => entry.group)).toEqual([
      "working",
      "attention",
      "idle",
    ]);
    expect(grouped[0]?.people.map((person) => person.id)).toEqual(["b", "d"]);
  });
});

describe("activePanelTab", () => {
  it("shows requests when some wait and nobody is selected", () => {
    expect(activePanelTab({ choice: null, selectedId: null, pendingCount: 2 })).toBe(
      "requests",
    );
  });

  it("shows the person hint when nothing waits", () => {
    expect(activePanelTab({ choice: null, selectedId: null, pendingCount: 0 })).toBe(
      "person",
    );
  });

  it("shows the person once one is selected, even with requests waiting", () => {
    expect(activePanelTab({ choice: null, selectedId: "x", pendingCount: 2 })).toBe(
      "person",
    );
  });

  it("keeps a tab the user picked", () => {
    expect(
      activePanelTab({ choice: "requests", selectedId: "x", pendingCount: 0 }),
    ).toBe("requests");
  });
});

describe("requestTiles", () => {
  it("shows one adjusted time", () => {
    expect(requestTiles([{ beforeLabel: "08:30", afterLabel: "08:00" }])).toEqual({
      was: "08:30",
      wordt: "08:00",
    });
  });

  it("has no 'was' for an added break and joins its two times", () => {
    expect(
      requestTiles([
        { beforeLabel: null, afterLabel: "12:00" },
        { beforeLabel: null, afterLabel: "12:30" },
      ]),
    ).toEqual({ was: null, wordt: "12:00–12:30" });
  });

  it("has no 'wordt' for a removed event", () => {
    expect(requestTiles([{ beforeLabel: "16:00", afterLabel: null }])).toEqual({
      was: "16:00",
      wordt: null,
    });
  });
});
