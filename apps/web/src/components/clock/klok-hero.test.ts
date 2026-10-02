import { describe, expect, it } from "vitest";

import type { Shift } from "@cloxa/domain";

import { klokHero } from "./klok-hero";

// 2026-09-28 is a Monday; Brussels is UTC+2 (CEST).
const at = (hour: number, minute: number) => Date.UTC(2026, 8, 28, hour - 2, minute);

function shift(partial: Partial<Shift> & Pick<Shift, "start">): Shift {
  return {
    end: null,
    breaks: [],
    grossMs: 0,
    breakMs: 0,
    netMs: 0,
    open: true,
    openBreak: false,
    overnight: false,
    edited: false,
    hasOffline: false,
    offlineSkewMs: null,
    ...partial,
  };
}

const planned = {
  start: at(8, 0),
  end: at(16, 30),
  netMs: 8 * 3_600_000,
  range: "08:00–16:30",
};

describe("klokHero", () => {
  it("is forest while working, with time, since and the Vandaag rows", () => {
    const open = shift({ start: at(8, 2) });
    const hero = klokHero({
      state: "working",
      since: open.start,
      now: at(12, 14),
      todayShifts: [open],
      pending: [],
      planned,
    });
    expect(hero.surface).toBe("forest");
    expect(hero.status).toBe("Je werkt");
    expect(hero.main).toBe("4u 12");
    expect(hero.sub).toBe("sinds 08:02");
    expect(hero.running).toBe(true);
    expect(hero.progress).toBeCloseTo((4 * 60 + 12) / (8 * 60), 5);
    expect(hero.rows.map((row) => [row.label, row.value])).toEqual([
      ["Gestart", "08:02"],
      ["Pauze", "geen"],
      ["Gepland tot", "16:30"],
    ]);
  });

  it("measures against 8 hours without a plan and never beyond full", () => {
    const open = shift({ start: at(6, 0) });
    const hero = klokHero({
      state: "working",
      since: open.start,
      now: at(18, 0),
      todayShifts: [open],
      pending: [],
      planned: null,
    });
    expect(hero.progress).toBe(1);
    expect(hero.rows.some((row) => row.key === "planned")).toBe(false);
  });

  it("is amber on a break and counts the break itself", () => {
    const open = shift({
      start: at(8, 0),
      openBreak: true,
      breaks: [{ start: at(12, 5), end: null }],
    });
    const hero = klokHero({
      state: "on_break",
      since: open.start,
      now: at(12, 35),
      todayShifts: [open],
      pending: [],
      planned: null,
    });
    expect(hero.surface).toBe("amber");
    expect(hero.status).toBe("Je bent op pauze");
    expect(hero.main).toBe("0u 30");
    expect(hero.sub).toBe("sinds 12:05");
    expect(hero.running).toBe(false);
  });

  it("is a white block when not started, with the plan as hint", () => {
    const hero = klokHero({
      state: "off",
      since: null,
      now: at(7, 0),
      todayShifts: [],
      pending: [],
      planned,
    });
    expect(hero.surface).toBe("light");
    expect(hero.status).toBe("Niet aan het werk");
    expect(hero.mainKind).toBe("text");
    expect(hero.sub).toBe("Gepland 08:00–16:30");
  });

  it("is white and totals the day once finished", () => {
    const closed = shift({
      start: at(8, 0),
      end: at(16, 31),
      open: false,
      netMs: 7 * 3_600_000 + 31 * 60_000,
      breakMs: 60 * 60_000,
    });
    const hero = klokHero({
      state: "off",
      since: null,
      now: at(17, 0),
      todayShifts: [closed],
      pending: [],
      planned,
      siteName: "Gent",
    });
    expect(hero.surface).toBe("light");
    expect(hero.status).toBe("Klaar voor vandaag");
    expect(hero.main).toBe("7u 31");
    expect(hero.sub).toBe("gestopt om 16:31");
    expect(hero.rows.map((row) => row.key)).toEqual([
      "started",
      "stopped",
      "pause",
      "planned",
      "site",
    ]);
  });
});
