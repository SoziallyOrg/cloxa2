import "server-only";

import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { env } from "@/lib/env.server";

import {
  checkSignature,
  DEV_UNSIGNED_KEY_ID,
  parseSigningKey,
  parseVerifyKeys,
  publicJwk,
  publicKeyOf,
  signBytes,
  type PublishedKey,
  type SignatureCheck,
} from "./signing";

interface Signer {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  /** The current public key first, then retired ones from EXPORT_VERIFY_KEYS. */
  readonly keyRing: ReadonlyMap<string, KeyObject>;
}

// One per process (this module can be evaluated in more than one bundle).
const cached = Symbol.for("cloxa.exportSigner");
const holder = globalThis as { [cached]?: Signer };

/**
 * The configured key, or outside production an ephemeral per-process key
 * marked `dev-unsigned`: its signatures prove nothing once the process
 * exits. env.server.ts refuses to start production without a real key.
 */
function signer(): Signer {
  const existing = holder[cached];
  if (existing) return existing;

  const configured = env.EXPORT_SIGNING_KEY
    ? parseSigningKey(env.EXPORT_SIGNING_KEY)
    : null;
  const keyId =
    configured && env.EXPORT_SIGNING_KEY_ID
      ? env.EXPORT_SIGNING_KEY_ID
      : DEV_UNSIGNED_KEY_ID;
  const privateKey =
    configured && env.EXPORT_SIGNING_KEY_ID
      ? configured
      : generateKeyPairSync("ed25519").privateKey;

  const keyRing = new Map<string, KeyObject>([[keyId, publicKeyOf(privateKey)]]);
  const retired = env.EXPORT_VERIFY_KEYS
    ? parseVerifyKeys(env.EXPORT_VERIFY_KEYS)
    : null;
  for (const [kid, key] of retired ?? []) {
    if (!keyRing.has(kid)) keyRing.set(kid, key);
  }

  const created: Signer = { keyId, privateKey, keyRing };
  holder[cached] = created;
  return created;
}

/** Sign the exact content bytes. The key never leaves this server. */
export function signExportContent(bytes: Uint8Array): {
  keyId: string;
  signatureHex: string;
} {
  const current = signer();
  return {
    keyId: current.keyId,
    signatureHex: signBytes(current.privateKey, bytes).toString("hex"),
  };
}

/** Check a stored export against the current and retired keys before serving it. */
export function checkExportSignature(
  bytes: Uint8Array,
  signatureHex: string,
  keyId: string,
): SignatureCheck {
  return checkSignature({
    bytes,
    signatureHex,
    keyId,
    keys: signer().keyRing,
    production: process.env.NODE_ENV === "production",
  });
}

/** Public keys anyone may use to verify a downloaded export: current first, then retired. */
export function publishedExportKeys(): { keys: PublishedKey[] } {
  return {
    keys: [...signer().keyRing].map(([kid, key]) => publicJwk(kid, key)),
  };
}
