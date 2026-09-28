import "server-only";

import { generateKeyPairSync, type KeyObject } from "node:crypto";

import { env } from "@/lib/env.server";

import {
  DEV_UNSIGNED_KEY_ID,
  parseSigningKey,
  publicJwk,
  publicKeyOf,
  signBytes,
  verifyBytes,
  type PublishedKey,
} from "./signing";

interface Signer {
  readonly keyId: string;
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
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

  let created: Signer;
  const configured = env.EXPORT_SIGNING_KEY
    ? parseSigningKey(env.EXPORT_SIGNING_KEY)
    : null;
  if (configured && env.EXPORT_SIGNING_KEY_ID) {
    created = {
      keyId: env.EXPORT_SIGNING_KEY_ID,
      privateKey: configured,
      publicKey: publicKeyOf(configured),
    };
  } else {
    const pair = generateKeyPairSync("ed25519");
    created = {
      keyId: DEV_UNSIGNED_KEY_ID,
      privateKey: pair.privateKey,
      publicKey: pair.publicKey,
    };
  }
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

export type SignatureCheck = "valid" | "invalid" | "unverifiable";

/**
 * Check a stored export before serving it. `unverifiable`: a `dev-unsigned`
 * export outside production (its per-process key may be gone). Everything
 * else must verify against the current key; a manager calling the RPC
 * directly cannot produce that.
 */
export function checkExportSignature(
  bytes: Uint8Array,
  signatureHex: string,
  keyId: string,
): SignatureCheck {
  const current = signer();
  if (keyId === current.keyId) {
    return verifyBytes(current.publicKey, bytes, Buffer.from(signatureHex, "hex"))
      ? "valid"
      : "invalid";
  }
  if (keyId === DEV_UNSIGNED_KEY_ID && process.env.NODE_ENV !== "production") {
    return "unverifiable";
  }
  return "invalid";
}

/** Public keys anyone may use to verify a downloaded export. */
export function publishedExportKeys(): { keys: PublishedKey[] } {
  const current = signer();
  return { keys: [publicJwk(current.keyId, current.publicKey)] };
}
