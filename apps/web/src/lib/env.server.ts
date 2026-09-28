import "server-only";

import { z } from "zod";

import { publicEnv } from "./env";

/**
 * Server-only env vars, including secrets. Importing this module from a
 * client component fails the build (see the `server-only` package).
 */
const serverSchema = z
  .object({
    SUPABASE_SECRET_KEY: z.string().min(1),
    CLOXA_SITE_URL: z.url(),
    /** HMAC key for the email and IP hashes sent to the attempt limiter. */
    AUTH_HASH_PEPPER: z.string().min(32),
    /** HMAC key for Cloxa's own signed cookies (login flow, org choice, activity). */
    FLOW_COOKIE_SECRET: z.string().min(32),
  })
  // One key per purpose: a leaked pepper must not forge cookies, and the
  // Supabase key never doubles as a signing key.
  .refine(
    (value) =>
      new Set([
        value.SUPABASE_SECRET_KEY,
        value.AUTH_HASH_PEPPER,
        value.FLOW_COOKIE_SECRET,
      ]).size === 3,
    {
      message:
        "SUPABASE_SECRET_KEY, AUTH_HASH_PEPPER and FLOW_COOKIE_SECRET must differ",
    },
  );

const serverOnlyEnv = serverSchema.parse({
  SUPABASE_SECRET_KEY: process.env["SUPABASE_SECRET_KEY"],
  CLOXA_SITE_URL: process.env["CLOXA_SITE_URL"],
  AUTH_HASH_PEPPER: process.env["AUTH_HASH_PEPPER"],
  FLOW_COOKIE_SECRET: process.env["FLOW_COOKIE_SECRET"],
});

export const env = {
  ...publicEnv,
  ...serverOnlyEnv,
};
