import { generateKeyPairSync } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  parseSigningKey,
  publicJwk,
  publicKeyOf,
  sha256Hex,
  signBytes,
  verifyBytes,
} from "./signing";

function base64Pem(): string {
  const { privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  return Buffer.from(pem, "utf8").toString("base64");
}

const content = Buffer.from('{"format_version":"cloxa.export.v1","rows":[]}', "utf8");

describe("export signing", () => {
  it("round-trips: a signature verifies with the published public key", () => {
    const privateKey = parseSigningKey(base64Pem());
    expect(privateKey).not.toBeNull();
    if (!privateKey) return;

    const signature = signBytes(privateKey, content);
    expect(signature).toHaveLength(64);
    expect(verifyBytes(publicKeyOf(privateKey), content, signature)).toBe(true);
  });

  it("fails for tampered content, a tampered signature or another key", () => {
    const privateKey = parseSigningKey(base64Pem());
    const otherKey = parseSigningKey(base64Pem());
    if (!privateKey || !otherKey) throw new Error("keys");
    const signature = signBytes(privateKey, content);

    const tampered = Buffer.from(content);
    tampered[tampered.length - 3] = 0x7b;
    expect(verifyBytes(publicKeyOf(privateKey), tampered, signature)).toBe(false);

    const badSignature = Buffer.from(signature);
    badSignature[0] = (badSignature[0] ?? 0) ^ 0xff;
    expect(verifyBytes(publicKeyOf(privateKey), content, badSignature)).toBe(false);

    expect(verifyBytes(publicKeyOf(otherKey), content, signature)).toBe(false);
    expect(verifyBytes(publicKeyOf(privateKey), content, Buffer.alloc(3))).toBe(false);
  });

  it("verifies with the JWK a third party would download", async () => {
    const privateKey = parseSigningKey(base64Pem());
    if (!privateKey) throw new Error("key");
    const jwk = publicJwk("prod-2026-09", publicKeyOf(privateKey));
    expect(jwk).toMatchObject({ kid: "prod-2026-09", kty: "OKP", crv: "Ed25519" });

    const { createPublicKey } = await import("node:crypto");
    const imported = createPublicKey({
      key: { kty: jwk.kty, crv: jwk.crv, x: jwk.x },
      format: "jwk",
    });
    expect(verifyBytes(imported, content, signBytes(privateKey, content))).toBe(true);
  });

  it("accepts only base64 PKCS8 Ed25519 keys", () => {
    const { privateKey: rsa } = generateKeyPairSync("rsa", { modulusLength: 1024 });
    const rsaPem = rsa.export({ format: "pem", type: "pkcs8" }).toString();
    expect(parseSigningKey(Buffer.from(rsaPem).toString("base64"))).toBeNull();
    expect(parseSigningKey("not a key")).toBeNull();
  });

  it("hashes like sha256sum", () => {
    expect(sha256Hex(Buffer.from("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
