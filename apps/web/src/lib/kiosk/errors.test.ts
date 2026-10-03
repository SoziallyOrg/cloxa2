import { describe, expect, it } from "vitest";

import { RpcError } from "@cloxa/db";

import {
  kioskErrorView,
  kioskFailureCode,
  manageKioskErrorKey,
  pairErrorKey,
  pinErrorKey,
} from "./errors";

const rpcError = (message: string, code = "42501") =>
  new RpcError("rpc_test", { message, code });

describe("kioskErrorView", () => {
  it("shows the tries left only when 2 or fewer remain", () => {
    expect(kioskErrorView("pin_invalid", 4)).toEqual({
      key: "kiosk.errorPin",
      unpaired: false,
      pinAgain: true,
    });
    expect(kioskErrorView("pin_invalid", 3).key).toBe("kiosk.errorPin");
    expect(kioskErrorView("pin_invalid", 2)).toEqual({
      key: "kiosk.errorPinTriesLeft",
      values: { count: 2 },
      unpaired: false,
      pinAgain: true,
    });
    expect(kioskErrorView("pin_invalid", 1).values).toEqual({ count: 1 });
    expect(kioskErrorView("pin_invalid", null).key).toBe("kiosk.errorPin");
  });

  it("maps locks, pauses and transitions", () => {
    expect(kioskErrorView("pin_locked").key).toBe("kiosk.errorLocked");
    expect(kioskErrorView("device_paused").key).toBe("kiosk.errorPaused");
    expect(kioskErrorView("invalid_transition")).toMatchObject({
      key: "kiosk.errorTransition",
      pinAgain: false,
    });
  });

  it("treats an unknown device as unpaired (revoked or never paired)", () => {
    expect(kioskErrorView("device_unknown")).toMatchObject({
      key: "kiosk.errorUnpaired",
      unpaired: true,
    });
  });

  it("falls back to a generic message", () => {
    expect(kioskErrorView("invalid_input").key).toBe("kiosk.errorGeneric");
    expect(kioskErrorView("something_new").key).toBe("kiosk.errorGeneric");
  });
});

describe("kioskFailureCode", () => {
  it("keeps the device refusals of a thrown roster call", () => {
    expect(kioskFailureCode(rpcError("device_unknown"))).toBe("device_unknown");
    expect(kioskFailureCode(rpcError("device_paused", "P0001"))).toBe("device_paused");
    expect(kioskFailureCode(rpcError("empty_response"))).toBe("generic");
  });

  it("recognises a network failure", () => {
    expect(kioskFailureCode(new TypeError("fetch failed"))).toBe("network");
    expect(kioskFailureCode(new Error("boom"))).toBe("generic");
  });
});

describe("form error keys", () => {
  it("maps pairing refusals", () => {
    expect(pairErrorKey("code_invalid")).toBe("kiosk.pairErrorCode");
    expect(pairErrorKey("pairing_paused")).toBe("kiosk.pairErrorPaused");
    expect(pairErrorKey("x")).toBe("kiosk.pairErrorGeneric");
  });

  it("maps PIN problems from the form and from the database alike", () => {
    expect(pinErrorKey("pin_too_simple")).toBe("kiosk.pinErrorSimple");
    expect(pinErrorKey(rpcError("pin_too_simple", "22023"))).toBe(
      "kiosk.pinErrorSimple",
    );
    expect(pinErrorKey(rpcError("pin_invalid_format", "22023"))).toBe(
      "kiosk.pinErrorFormat",
    );
    expect(pinErrorKey("pin_mismatch")).toBe("kiosk.pinErrorMismatch");
    expect(pinErrorKey(rpcError("not_authorized"))).toBe("kiosk.pinErrorNotAllowed");
    expect(pinErrorKey(new Error("x"))).toBe("kiosk.pinErrorGeneric");
  });

  it("maps kiosk management refusals", () => {
    expect(manageKioskErrorKey(rpcError("invalid_name", "22023"))).toBe(
      "manageKiosks.errorName",
    );
    expect(manageKioskErrorKey(rpcError("not_authorized"))).toBe(
      "manageKiosks.errorNotAllowed",
    );
    expect(manageKioskErrorKey(rpcError("device_revoked", "22023"))).toBe(
      "manageKiosks.errorRevoked",
    );
    expect(manageKioskErrorKey(new Error("x"))).toBe("manageKiosks.errorGeneric");
  });
});
