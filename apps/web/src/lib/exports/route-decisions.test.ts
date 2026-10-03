import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { describe, expect, it } from "vitest";

import { downloadAccess, integrityVerdict, selfExportRequest } from "./route-decisions";
import {
  checkSignature,
  DEV_UNSIGNED_KEY_ID,
  sha256Hex,
  signBytes,
  type SignatureCheck,
} from "./signing";

const bytes = Buffer.from('{"format_version":"cloxa.export.v1","rows":[]}', "utf8");

function keyPair(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("ed25519");
}

function verdictFor(signature: SignatureCheck, content = bytes) {
  return integrityVerdict({
    storedSha256Hex: sha256Hex(bytes),
    actualSha256Hex: sha256Hex(content),
    signature,
  });
}

describe("downloadAccess", () => {
  it("refuses anonymous visitors and members without a privileged, fresh session", () => {
    expect(downloadAccess({ member: false, privileged: false, gateOk: false })).toBe(
      403,
    );
    expect(downloadAccess({ member: true, privileged: false, gateOk: false })).toBe(
      403,
    );
    expect(downloadAccess({ member: true, privileged: true, gateOk: false })).toBe(403);
    expect(downloadAccess({ member: true, privileged: true, gateOk: true })).toBe(200);
  });
});

describe("integrityVerdict", () => {
  const current = keyPair();
  const keys = new Map([["prod-2", current.publicKey]]);
  const signatureHex = signBytes(current.privateKey, bytes).toString("hex");

  it("serves an intact, correctly signed export", () => {
    const check = checkSignature({
      bytes,
      signatureHex,
      keyId: "prod-2",
      keys,
      production: true,
    });
    expect(verdictFor(check)).toEqual({ ok: true });
  });

  it("gives 409 for a bad signature", () => {
    const forged = keyPair();
    const check = checkSignature({
      bytes,
      signatureHex: signBytes(forged.privateKey, bytes).toString("hex"),
      keyId: "prod-2",
      keys,
      production: true,
    });
    expect(verdictFor(check)).toEqual({ ok: false, status: 409, reason: "signature" });
  });

  it("gives 409 for dev-unsigned exports in production", () => {
    const check = checkSignature({
      bytes,
      signatureHex,
      keyId: DEV_UNSIGNED_KEY_ID,
      keys,
      production: true,
    });
    expect(verdictFor(check)).toEqual({ ok: false, status: 409, reason: "signature" });
  });

  it("lets a dev-unsigned export through outside production", () => {
    const check = checkSignature({
      bytes,
      signatureHex,
      keyId: DEV_UNSIGNED_KEY_ID,
      keys,
      production: false,
    });
    expect(check).toBe("unverifiable");
    expect(verdictFor(check)).toEqual({ ok: true });
  });

  it("gives 409 when the bytes no longer match the stored hash", () => {
    expect(verdictFor("valid", Buffer.from("{}"))).toEqual({
      ok: false,
      status: 409,
      reason: "hash",
    });
  });
});

describe("selfExportRequest", () => {
  const now = Date.parse("2026-09-15T10:00:00Z");

  it("accepts a past or the current month, cut off at today", () => {
    expect(selfExportRequest("2026-08", now)).toEqual({
      ok: true,
      month: "2026-08",
      period: { from: "2026-08-01", to: "2026-08-31" },
    });
    expect(selfExportRequest("2026-09", now)).toEqual({
      ok: true,
      month: "2026-09",
      period: { from: "2026-09-01", to: "2026-09-15" },
    });
  });

  it("gives 400 for a missing, malformed or future month", () => {
    for (const maand of [null, "", "2026-13", "2026-9", "abc", "1999-01", "2026-10"]) {
      expect(selfExportRequest(maand, now)).toEqual({ ok: false, status: 400 });
    }
  });

  it("uses the Brussels calendar at the month boundary", () => {
    // 30 September 22:30Z is already 1 October in Brussels.
    expect(
      selfExportRequest("2026-10", Date.parse("2026-09-30T22:30:00Z")),
    ).toMatchObject({ ok: true, period: { from: "2026-10-01", to: "2026-10-01" } });
  });
});
