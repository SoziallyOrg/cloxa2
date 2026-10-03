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

import { z } from "zod";

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

export type SignatureCheck = "valid" | "invalid" | "unverifiable";

/**
 * Check a stored export against the key ring (current key plus retired
 * `EXPORT_VERIFY_KEYS`). `unverifiable`: a `dev-unsigned` export outside
 * production, whose per-process key may be gone. Anything else must verify;
 * a manager calling the RPC directly cannot produce that.
 */
export function checkSignature(input: {
  bytes: Uint8Array;
  signatureHex: string;
  keyId: string;
  keys: ReadonlyMap<string, KeyObject>;
  production: boolean;
}): SignatureCheck {
  if (input.keyId === DEV_UNSIGNED_KEY_ID && !input.production) {
    const devKey = input.keys.get(DEV_UNSIGNED_KEY_ID);
    return devKey &&
      verifyBytes(devKey, input.bytes, Buffer.from(input.signatureHex, "hex"))
      ? "valid"
      : "unverifiable";
  }
  if (input.keyId === DEV_UNSIGNED_KEY_ID) return "invalid";
  const key = input.keys.get(input.keyId);
  if (!key) return "invalid";
  return verifyBytes(key, input.bytes, Buffer.from(input.signatureHex, "hex"))
    ? "valid"
    : "invalid";
}

const verifyKeysSchema = z
  .array(
    z.strictObject({
      kid: z
        .string()
        .regex(KEY_ID_PATTERN)
        .refine((kid) => kid !== DEV_UNSIGNED_KEY_ID),
      publicKeyJwk: z.object({
        kty: z.literal("OKP"),
        crv: z.literal("Ed25519"),
        x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    }),
  )
  .max(20)
  .refine((keys) => new Set(keys.map((key) => key.kid)).size === keys.length);

/**
 * `EXPORT_VERIFY_KEYS`: a JSON list of `{kid, publicKeyJwk}` for retired
 * signing keys, so exports signed before a rotation still verify. Null when
 * the value is not valid.
 */
export function parseVerifyKeys(json: string): Map<string, KeyObject> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const parsed = verifyKeysSchema.safeParse(raw);
  if (!parsed.success) return null;
  const keys = new Map<string, KeyObject>();
  try {
    for (const { kid, publicKeyJwk } of parsed.data) {
      keys.set(kid, createPublicKey({ key: publicKeyJwk, format: "jwk" }));
    }
  } catch {
    return null;
  }
  return keys;
}
