/**
 * Ed25519 primitives for export signatures (Node `crypto`, no extra
 * dependency). Pure: keys come in as arguments; `sign.ts` owns the env key.
 * The signature covers the exact stored content bytes.
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";

export const SIGNATURE_ALGORITHM = "Ed25519";
/** Key id of the per-process key used when no signing key is configured (dev only). */
export const DEV_UNSIGNED_KEY_ID = "dev-unsigned";
export const KEY_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

/** A base64-encoded PKCS8 PEM holding an Ed25519 private key, or null. */
export function parseSigningKey(base64Pem: string): KeyObject | null {
  try {
    const pem = Buffer.from(base64Pem, "base64").toString("utf8");
    const key = createPrivateKey({ key: pem, format: "pem" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

export function publicKeyOf(privateKey: KeyObject): KeyObject {
  return createPublicKey(privateKey);
}

export function signBytes(privateKey: KeyObject, bytes: Uint8Array): Buffer {
  return sign(null, bytes, privateKey);
}

export function verifyBytes(
  publicKey: KeyObject,
  bytes: Uint8Array,
  signature: Uint8Array,
): boolean {
  try {
    return verify(null, bytes, publicKey, signature);
  } catch {
    return false;
  }
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface PublishedKey {
  readonly kid: string;
  readonly kty: "OKP";
  readonly crv: "Ed25519";
  readonly x: string;
  readonly alg: "EdDSA";
  readonly use: "sig";
}

/** RFC 8037 JWK for a public key, as published at `/.well-known/cloxa-export-keys.json`. */
export function publicJwk(kid: string, publicKey: KeyObject): PublishedKey {
  const jwk = publicKey.export({ format: "jwk" });
  return {
    kid,
    kty: "OKP",
    crv: "Ed25519",
    x: String(jwk.x),
    alg: "EdDSA",
    use: "sig",
  };
}
