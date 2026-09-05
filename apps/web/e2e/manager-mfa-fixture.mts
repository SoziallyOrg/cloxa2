import { createHmac } from "node:crypto";
import { expect, type Page } from "@playwright/test";

type MfaClient = {
  auth: {
    mfa: {
      challenge(input: {
        factorId: string;
      }): Promise<{ data: { id: string } | null; error: unknown }>;
      enroll(input: {
        factorType: "totp";
        friendlyName: string;
        issuer: string;
      }): Promise<{
        data: { id: string; type: string; totp: { secret: string } } | null;
        error: unknown;
      }>;
      verify(input: {
        factorId: string;
        challengeId: string;
        code: string;
      }): Promise<{ error: unknown }>;
    };
  };
  rpc(name: string): Promise<{ data: unknown; error: unknown }>;
};

const managerFactors = new Map<string, { factorId: string; secret: string }>();
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string) {
  let bits = "";
  for (const character of value.replaceAll("=", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid synthetic TOTP seed.");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

export function currentTotp(secret: string, now = Date.now()) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 30_000)));
  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function verifyFactor(client: MfaClient, factorId: string, secret: string) {
  const challenge = await client.auth.mfa.challenge({ factorId });
  if (challenge.error || !challenge.data?.id)
    throw new Error("Synthetic manager MFA challenge failed.");
  const verification = await client.auth.mfa.verify({
    factorId,
    challengeId: challenge.data.id,
    code: currentTotp(secret),
  });
  if (verification.error) throw new Error("Synthetic manager MFA verification failed.");
}

export async function enrollManagerMfa(client: MfaClient, email: string) {
  const enrollment = await client.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: "Synthetic Cloxa manager",
    issuer: "Cloxa",
  });
  if (
    enrollment.error ||
    !enrollment.data ||
    enrollment.data.type !== "totp" ||
    !enrollment.data.totp.secret
  ) {
    throw new Error("Synthetic manager MFA enrollment failed.");
  }
  const factor = {
    factorId: enrollment.data.id,
    secret: enrollment.data.totp.secret,
  };
  managerFactors.set(email, factor);
  await verifyFactor(client, factor.factorId, factor.secret);
  const registration = await client.rpc("register_manager_mfa");
  if (registration.error || registration.data !== "ready")
    throw new Error("Synthetic manager MFA registration failed.");
}

export async function elevateManagerSession(client: MfaClient, email: string) {
  const factor = managerFactors.get(email);
  if (!factor) throw new Error("Synthetic manager MFA seed is unavailable.");
  await verifyFactor(client, factor.factorId, factor.secret);
}

export async function finishManagerBrowserLogin(
  page: Page,
  email: string,
  expectedPath = "/manager",
) {
  const factor = managerFactors.get(email);
  if (!factor) throw new Error("Synthetic manager MFA seed is unavailable.");
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe("/manager/security/verify");
  await page
    .getByLabel("Authenticatorcode", { exact: true })
    .fill(currentTotp(factor.secret));
  await page.getByRole("button", { name: "Code controleren", exact: true }).click();
  await expect.poll(() => new URL(page.url()).pathname).toBe(expectedPath);
}
