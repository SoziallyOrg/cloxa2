import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  mintActivity,
  mintFlow,
  mintOrgChoice,
  readActivity,
  readFlow,
  readOrgChoice,
} from "./session-cookies";
import { signValue, verifyValue } from "./signed-cookie";

const SECRET = "s".repeat(32);
const NOW = Date.UTC(2026, 8, 28, 10, 0, 0);
const schema = z.object({ a: z.number() });
const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const ORG = "33333333-3333-4333-8333-333333333333";

function sign(data: unknown, ttlSeconds = 60) {
  return signValue(data, { secret: SECRET, purpose: "flow", ttlSeconds, now: NOW });
}

describe("signValue / verifyValue", () => {
  it("round-trips before expiry", () => {
    expect(
      verifyValue(sign({ a: 1 }), schema, {
        secret: SECRET,
        purpose: "flow",
        now: NOW,
      }),
    ).toEqual({ a: 1 });
  });

  it("rejects a tampered payload", () => {
    const [body, signature] = sign({ a: 1 }).split(".") as [string, string];
    const forged = Buffer.from(
      Buffer.from(body, "base64url").toString("utf8").replace('"a":1', '"a":2'),
    ).toString("base64url");
    expect(
      verifyValue(`${forged}.${signature}`, schema, {
        secret: SECRET,
        purpose: "flow",
        now: NOW,
      }),
    ).toBeNull();
  });

  it("rejects a tampered signature, a wrong secret and malformed tokens", () => {
    const token = sign({ a: 1 });
    const flipped = `${token.slice(0, -2)}${token.endsWith("AA") ? "BB" : "AA"}`;
    const options = { secret: SECRET, purpose: "flow" as const, now: NOW };
    expect(verifyValue(flipped, schema, options)).toBeNull();
    expect(
      verifyValue(token, schema, { ...options, secret: "x".repeat(32) }),
    ).toBeNull();
    expect(verifyValue("", schema, options)).toBeNull();
    expect(verifyValue("abc", schema, options)).toBeNull();
    expect(verifyValue(`${token}.extra`, schema, options)).toBeNull();
    expect(verifyValue(undefined, schema, options)).toBeNull();
  });

  it("rejects after expiry", () => {
    const token = sign({ a: 1 }, 60);
    const options = { secret: SECRET, purpose: "flow" as const };
    expect(verifyValue(token, schema, { ...options, now: NOW + 59_000 })).toEqual({
      a: 1,
    });
    expect(verifyValue(token, schema, { ...options, now: NOW + 60_000 })).toBeNull();
  });

  it("rejects a value signed for another purpose", () => {
    expect(
      verifyValue(sign({ a: 1 }), schema, { secret: SECRET, purpose: "org", now: NOW }),
    ).toBeNull();
  });

  it("rejects data that fails the schema", () => {
    expect(
      verifyValue(sign({ a: "1" }), schema, {
        secret: SECRET,
        purpose: "flow",
        now: NOW,
      }),
    ).toBeNull();
  });
});

describe("Cloxa cookie payloads", () => {
  it("flow keeps email and next for 10 minutes", () => {
    const token = mintFlow({ email: "jan@example.be", next: "/app" }, SECRET, NOW);
    expect(readFlow(token, SECRET, NOW + 9 * 60_000)).toEqual({
      email: "jan@example.be",
      next: "/app",
    });
    expect(readFlow(token, SECRET, NOW + 10 * 60_000)).toBeNull();
  });

  it("org choice and activity are bound to the user", () => {
    const org = mintOrgChoice(USER, ORG, SECRET, NOW);
    expect(readOrgChoice(org, USER, SECRET, NOW)).toBe(ORG);
    expect(readOrgChoice(org, OTHER_USER, SECRET, NOW)).toBeNull();

    const activity = mintActivity(USER, SECRET, NOW);
    expect(readActivity(activity, USER, SECRET, NOW)).toBe(NOW / 1000);
    expect(readActivity(activity, OTHER_USER, SECRET, NOW)).toBeNull();
  });

  it("an activity cookie cannot stand in for an org choice", () => {
    const activity = mintActivity(USER, SECRET, NOW);
    expect(readOrgChoice(activity, USER, SECRET, NOW)).toBeNull();
  });
});
