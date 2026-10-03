import { describe, expect, it } from "vitest";

import {
  buildCorrectionPayload,
  canAdvance,
  INITIAL_CORRECTION_FORM_STATE,
  type CorrectionFormState,
} from "@/lib/corrections/form";

import { parseManagerCorrection } from "./correct-input";

const EMPLOYEE = "11111111-1111-4111-8111-111111111111";
const OTHER = "99999999-9999-4999-8999-999999999999";
const SITE = "22222222-2222-4222-8222-222222222222";

const state: CorrectionFormState = {
  ...INITIAL_CORRECTION_FORM_STATE,
  step: 3,
  kind: "add",
  eventType: "clock_out",
  date: "2026-10-01",
  time: "16:30",
  reason: "  Vergeten uit te klokken.  ",
};

describe("manager variant of the form payload", () => {
  it("requires a reason, with no default text", () => {
    const options = { reasonRequired: true };
    expect(buildCorrectionPayload({ ...state, reason: "" }, SITE, options)).toBeNull();
    expect(
      buildCorrectionPayload({ ...state, reason: "   " }, SITE, options),
    ).toBeNull();
    expect(canAdvance({ ...state, reason: " " }, [], options)).toBe(false);
    expect(canAdvance(state, [], options)).toBe(true);
    // The employee's wizard still sends a default.
    expect(buildCorrectionPayload({ ...state, reason: "" }, SITE)).not.toBeNull();
  });

  it("builds the proposal with the trimmed reason and the chosen site", () => {
    const payload = buildCorrectionPayload(state, SITE, { reasonRequired: true });
    expect(payload).toMatchObject({
      kind: "add",
      reason: "Vergeten uit te klokken.",
      events: [
        { type: "clock_out", siteId: SITE, occurredAt: "2026-10-01T14:30:00.000Z" },
      ],
    });
  });
});

describe("parseManagerCorrection", () => {
  const proposal = buildCorrectionPayload(state, SITE, { reasonRequired: true });

  it("adds the employee from the route", () => {
    expect(parseManagerCorrection(EMPLOYEE, proposal)).toMatchObject({
      employeeId: EMPLOYEE,
      kind: "add",
    });
  });

  it("overrides an employee id sent by the client", () => {
    expect(
      parseManagerCorrection(EMPLOYEE, { ...proposal, employeeId: OTHER })?.employeeId,
    ).toBe(EMPLOYEE);
  });

  it("refuses a missing reason and non-objects", () => {
    expect(parseManagerCorrection(EMPLOYEE, { ...proposal, reason: "" })).toBeNull();
    expect(parseManagerCorrection(EMPLOYEE, null)).toBeNull();
    expect(parseManagerCorrection(EMPLOYEE, "x")).toBeNull();
    expect(parseManagerCorrection("not-a-uuid", proposal)).toBeNull();
  });
});
