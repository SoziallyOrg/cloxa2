import { describe, expect, it } from "vitest";

import {
  buildCorrectionPayload,
  describeMoment,
  canAdvance,
  goBack,
  goNext,
  INITIAL_CORRECTION_FORM_STATE,
  type CorrectionFormState,
  type CorrectionTargetOption,
} from "./form";

const SITE_ID = "11111111-1111-1111-1111-111111111111";
const EVENT_ID = "22222222-2222-2222-2222-222222222222";
const TARGETS: readonly CorrectionTargetOption[] = [
  { id: EVENT_ID, type: "clock_in", occurredAtIso: "2026-09-27T06:00:00.000Z" },
];

describe("step navigation", () => {
  it("won't advance from step 1 without a chosen kind", () => {
    expect(canAdvance(INITIAL_CORRECTION_FORM_STATE, [])).toBe(false);
    expect(goNext(INITIAL_CORRECTION_FORM_STATE, [])).toBe(
      INITIAL_CORRECTION_FORM_STATE,
    );
  });

  it("advances once a kind is chosen, and can go back", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      kind: "add",
    };
    const advanced = goNext(state, []);
    expect(advanced.step).toBe(2);
    expect(goBack(advanced).step).toBe(1);
  });

  it("won't leave step 1 unaffected when going back from it", () => {
    expect(goBack(INITIAL_CORRECTION_FORM_STATE)).toBe(INITIAL_CORRECTION_FORM_STATE);
  });

  it("requires an event type, date and time for 'add' at step 2", () => {
    const base: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      step: 2,
      kind: "add",
    };
    expect(canAdvance(base, [])).toBe(false);
    expect(
      canAdvance(
        { ...base, eventType: "clock_in", date: "2026-09-27", time: "08:00" },
        [],
      ),
    ).toBe(true);
  });

  it("requires a target and a new time for 'adjust' at step 2", () => {
    const base: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      step: 2,
      kind: "adjust",
    };
    expect(canAdvance(base, TARGETS)).toBe(false);
    expect(
      canAdvance(
        { ...base, targetEventId: EVENT_ID, date: "2026-09-27", time: "08:05" },
        TARGETS,
      ),
    ).toBe(true);
  });

  it("requires a target for 'remove' at step 2, and refuses when there are none", () => {
    const base: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      step: 2,
      kind: "remove",
      targetEventId: EVENT_ID,
    };
    expect(canAdvance(base, [])).toBe(false);
    expect(canAdvance(base, TARGETS)).toBe(true);
  });

  it("always allows advancing from step 3 (reason is optional)", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      step: 3,
      kind: "remove",
      targetEventId: EVENT_ID,
    };
    expect(canAdvance(state, TARGETS)).toBe(true);
  });
});

describe("buildCorrectionPayload", () => {
  it("builds an 'add' payload with a Brussels-local time converted to an instant", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      kind: "add",
      eventType: "clock_in",
      date: "2026-09-27",
      time: "08:00",
      reason: "Vergeten in te klokken",
    };
    expect(buildCorrectionPayload(state, SITE_ID)).toEqual({
      kind: "add",
      events: [
        { type: "clock_in", occurredAt: "2026-09-27T06:00:00.000Z", siteId: SITE_ID },
      ],
      reason: "Vergeten in te klokken",
    });
  });

  it("handles the DST spring-forward gap in an 'add' payload", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      kind: "add",
      eventType: "clock_in",
      date: "2026-03-29",
      time: "02:30",
      reason: "",
    };
    const payload = buildCorrectionPayload(state, SITE_ID);
    expect(payload?.kind).toBe("add");
    if (payload?.kind === "add") {
      expect(payload.events[0]?.occurredAt).toBe("2026-03-29T01:30:00.000Z");
    }
    expect(payload?.reason).toBe("Geen reden opgegeven.");
  });

  it("builds an 'adjust' payload", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      kind: "adjust",
      targetEventId: EVENT_ID,
      date: "2026-09-27",
      time: "08:05",
      reason: "Typfout",
    };
    expect(buildCorrectionPayload(state, SITE_ID)).toEqual({
      kind: "adjust",
      events: [{ targetEventId: EVENT_ID, occurredAt: "2026-09-27T06:05:00.000Z" }],
      reason: "Typfout",
    });
  });

  it("adjusts a night shift's clock-out on its own day, not the shift's day", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      kind: "adjust",
      targetEventId: EVENT_ID,
      date: "2026-09-25",
      time: "05:30",
      reason: "Typfout",
    };
    // 05:12 on Saturday 26 Sep (CEST) is 03:12Z.
    const targets = [
      {
        id: EVENT_ID,
        type: "clock_out" as const,
        occurredAtIso: "2026-09-26T03:12:00.000Z",
        dayLabel: "za 26 sep",
      },
    ];
    expect(buildCorrectionPayload(state, SITE_ID, {}, targets)).toEqual({
      kind: "adjust",
      events: [{ targetEventId: EVENT_ID, occurredAt: "2026-09-26T03:30:00.000Z" }],
      reason: "Typfout",
    });
  });

  it("describes a moment with its day only when it is another day", () => {
    expect(describeMoment("Gestopt met werken", "05:12", "za 3 okt")).toBe(
      "Gestopt met werken om 05:12 (za 3 okt)",
    );
    expect(describeMoment("Gestopt met werken", "17:05")).toBe(
      "Gestopt met werken om 17:05",
    );
  });

  it("builds a 'remove' payload without a time", () => {
    const state: CorrectionFormState = {
      ...INITIAL_CORRECTION_FORM_STATE,
      kind: "remove",
      targetEventId: EVENT_ID,
      reason: "Dubbele registratie",
    };
    expect(buildCorrectionPayload(state, SITE_ID)).toEqual({
      kind: "remove",
      targetEventIds: [EVENT_ID],
      reason: "Dubbele registratie",
    });
  });

  it("returns null when the form isn't complete", () => {
    expect(buildCorrectionPayload(INITIAL_CORRECTION_FORM_STATE, SITE_ID)).toBeNull();
    expect(
      buildCorrectionPayload(
        { ...INITIAL_CORRECTION_FORM_STATE, kind: "add", eventType: "clock_in" },
        SITE_ID,
      ),
    ).toBeNull();
  });
});
