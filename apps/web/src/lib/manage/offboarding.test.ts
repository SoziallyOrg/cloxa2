import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import {
  effectiveRetentionYears,
  mapOffboardError,
  offboardConfirmLines,
} from "./offboarding";

function render(lines: ReturnType<typeof offboardConfirmLines>): string[] {
  return lines.map((line) => t(line.key, line.values));
}

describe("offboardConfirmLines", () => {
  it("tells a person with a login they are signed out, and what stays", () => {
    const text = render(
      offboardConfirmLines({
        name: "Jan",
        hasLogin: true,
        hasPin: true,
        retentionYears: 7,
      }),
    );
    expect(text).toEqual([
      "Jan kan niet meer inloggen en wordt op alle toestellen afgemeld.",
      "Jan kan niet meer klokken, ook niet op de kiosk.",
      "De kiosk-pincode van Jan wordt gewist.",
      "Alle geregistreerde uren blijven bewaard.",
      "Na 7 jaar maakt Cloxa de gegevens automatisch anoniem: de naam verdwijnt, de uren blijven.",
      'Vergist? Met de knop "Terug in dienst" draai je dit terug.',
    ]);
  });

  it("skips the sign-out line for a kiosk-only worker", () => {
    const keys = offboardConfirmLines({
      name: "Els",
      hasLogin: false,
      hasPin: false,
      retentionYears: 5,
    }).map((line) => line.key);
    expect(keys).not.toContain("manageEmployee.offboardConsequenceLogin");
    expect(keys).not.toContain("manageEmployee.offboardConsequencePin");
    expect(keys[0]).toBe("manageEmployee.offboardConsequenceClock");
  });

  it("never promises less than the 5-year minimum", () => {
    const retention = offboardConfirmLines({
      name: "Els",
      hasLogin: false,
      hasPin: false,
      retentionYears: 2,
    }).find((line) => line.key === "manageEmployee.offboardConsequenceRetention");
    expect(retention?.values).toEqual({ years: 5 });
  });
});

describe("effectiveRetentionYears", () => {
  it("reads the setting and applies the floor", () => {
    expect(effectiveRetentionYears({ retention_years: 8 })).toBe(8);
    expect(effectiveRetentionYears({ retention_years: 3 })).toBe(5);
    expect(effectiveRetentionYears({})).toBe(5);
    expect(effectiveRetentionYears(null)).toBe(5);
    expect(effectiveRetentionYears({ retention_years: "9" })).toBe(5);
  });
});

describe("mapOffboardError", () => {
  const rpc = (message: string) =>
    new RpcError("rpc_offboard_employee", { message, code: "42501" });

  it("maps the database refusals to plain copy", () => {
    expect(mapOffboardError(rpc("cannot_offboard_owner"))).toBe(
      "manageEmployee.errorOwner",
    );
    expect(mapOffboardError(rpc("cannot_offboard_self"))).toBe(
      "manageEmployee.errorSelf",
    );
    expect(mapOffboardError(rpc("employee_anonymised"))).toBe(
      "manageEmployee.errorAnonymised",
    );
    expect(mapOffboardError(rpc("not_authorized"))).toBe(
      "manageEmployee.errorNotAllowed",
    );
    expect(mapOffboardError(rpc("membership_suspended"))).toBe(
      "manageEmployee.errorMembershipSuspended",
    );
    expect(mapOffboardError(rpc("left_at_before_last_event"))).toBe(
      "manageEmployee.errorLeftAtBeforeLastEvent",
    );
    expect(mapOffboardError(new Error("boom"))).toBe("manageEmployee.errorGeneric");
  });
});
