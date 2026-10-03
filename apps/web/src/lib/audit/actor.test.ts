import { describe, expect, it } from "vitest";

import { auditActorLabel } from "./actor";

describe("auditActorLabel", () => {
  it("is a person when actor_user_id is set", () => {
    expect(
      auditActorLabel({
        actorUserId: "user-1",
        displayName: "Olivia Eigenaar",
        deviceId: null,
        deviceName: null,
      }),
    ).toEqual({ kind: "person", name: "Olivia Eigenaar" });
  });

  it("is a person with a null name when the employee row can't be resolved", () => {
    expect(
      auditActorLabel({
        actorUserId: "user-1",
        displayName: null,
        deviceId: null,
        deviceName: null,
      }),
    ).toEqual({ kind: "person", name: null });
  });

  it("is a kiosk when the actor is null but metadata.device_id is set", () => {
    expect(
      auditActorLabel({
        actorUserId: null,
        displayName: null,
        deviceId: "device-1",
        deviceName: "Ingang magazijn",
      }),
    ).toEqual({ kind: "kiosk", deviceName: "Ingang magazijn" });
  });

  it("is a kiosk with a null name when the device row can't be resolved", () => {
    expect(
      auditActorLabel({
        actorUserId: null,
        displayName: null,
        deviceId: "device-1",
        deviceName: null,
      }),
    ).toEqual({ kind: "kiosk", deviceName: null });
  });

  it("is the system when there's no actor and no device", () => {
    expect(
      auditActorLabel({
        actorUserId: null,
        displayName: null,
        deviceId: null,
        deviceName: null,
      }),
    ).toEqual({ kind: "system" });
  });
});
