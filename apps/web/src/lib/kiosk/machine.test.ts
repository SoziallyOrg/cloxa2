import { describe, expect, it } from "vitest";

import { kioskErrorView } from "./errors";
import {
  DONE_RETURN_MS,
  firstName,
  IDLE_PHASE,
  INACTIVITY_RETURN_MS,
  kioskReducer,
  returnDelayMs,
  type KioskEvent,
  type KioskPhase,
} from "./machine";

const JAN = { id: "e1", name: "Jan Janssens", hasPin: true };

function run(events: readonly KioskEvent[], from: KioskPhase = IDLE_PHASE): KioskPhase {
  return events.reduce(kioskReducer, from);
}

describe("kiosk state machine", () => {
  it("goes idle → pin → action → done → back to idle after the timeout", () => {
    const pin = run([{ type: "select", person: JAN }]);
    expect(pin).toEqual({ kind: "pin", person: JAN, busy: false, error: null });
    expect(returnDelayMs(pin)).toBe(INACTIVITY_RETURN_MS);

    const checking = kioskReducer(pin, { type: "submitPin" });
    expect(checking).toMatchObject({ kind: "pin", busy: true });

    const action = kioskReducer(checking, {
      type: "statusOk",
      pin: "2580",
      state: "off",
    });
    expect(action).toEqual({
      kind: "action",
      person: JAN,
      pin: "2580",
      state: "off",
      busy: false,
      error: null,
    });
    expect(returnDelayMs(action)).toBe(INACTIVITY_RETURN_MS);

    const done = run(
      [
        { type: "submitAction" },
        { type: "clockOk", clockType: "clock_in", time: "08:02" },
      ],
      action,
    );
    expect(done).toEqual({
      kind: "done",
      person: JAN,
      clockType: "clock_in",
      time: "08:02",
    });
    expect(returnDelayMs(done)).toBe(DONE_RETURN_MS);

    const back = kioskReducer(done, { type: "timeout" });
    expect(back).toEqual(IDLE_PHASE);
    expect(returnDelayMs(back)).toBeNull();
  });

  it("forgets the PIN when the action screen times out", () => {
    const action = run([
      { type: "select", person: JAN },
      { type: "submitPin" },
      { type: "statusOk", pin: "2580", state: "working" },
      { type: "timeout" },
    ]);
    expect(action).toEqual(IDLE_PHASE);
  });

  it("stays on the PIN pad with the error after a wrong PIN", () => {
    const error = kioskErrorView("pin_invalid", 2);
    const phase = run([
      { type: "select", person: JAN },
      { type: "submitPin" },
      { type: "failed", error },
    ]);
    expect(phase).toEqual({ kind: "pin", person: JAN, busy: false, error });
    expect(kioskReducer(phase, { type: "submitPin" })).toMatchObject({ error: null });
  });

  it("asks for the PIN again when the clock call is refused for the PIN", () => {
    const locked = kioskErrorView("pin_locked");
    const phase = run([
      { type: "select", person: JAN },
      { type: "submitPin" },
      { type: "statusOk", pin: "2580", state: "off" },
      { type: "submitAction" },
      { type: "failed", error: locked },
    ]);
    expect(phase).toEqual({ kind: "pin", person: JAN, busy: false, error: locked });
  });

  it("keeps the action screen for a transition error", () => {
    const error = kioskErrorView("invalid_transition");
    const phase = run([
      { type: "select", person: JAN },
      { type: "submitPin" },
      { type: "statusOk", pin: "2580", state: "off" },
      { type: "submitAction" },
      { type: "failed", error },
    ]);
    expect(phase).toMatchObject({ kind: "action", busy: false, error });
  });

  it("returns to idle when the tablet turns out to be unpaired", () => {
    const phase = run([
      { type: "select", person: JAN },
      { type: "submitPin" },
      { type: "failed", error: kioskErrorView("device_unknown") },
    ]);
    expect(phase).toEqual(IDLE_PHASE);
  });

  it("ignores events that do not fit the current screen", () => {
    expect(kioskReducer(IDLE_PHASE, { type: "submitPin" })).toBe(IDLE_PHASE);
    expect(
      kioskReducer(IDLE_PHASE, {
        type: "clockOk",
        clockType: "clock_in",
        time: "08:00",
      }),
    ).toBe(IDLE_PHASE);
    const pin = run([{ type: "select", person: JAN }]);
    expect(kioskReducer(pin, { type: "select", person: { ...JAN, id: "e2" } })).toBe(
      pin,
    );
  });

  it("greets by first name", () => {
    expect(firstName(" Jan  Janssens ")).toBe("Jan");
    expect(firstName("Els")).toBe("Els");
  });
});
