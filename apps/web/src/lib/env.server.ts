import "server-only";

import { z } from "zod";

import { proxyModeSetting, type ProxyMode } from "./auth/hash";
import { turnstileEnabled } from "./auth/turnstile-config";
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
    /**
     * Which header carries the client IP: `vercel`, `append:<n>` or `none`.
     * Required in production; `none` when unset elsewhere.
     */
    CLOXA_PROXY_MODE: z
      .string()
      .optional()
      .transform((value, context): ProxyMode => {
        const mode = proxyModeSetting(value, process.env.NODE_ENV === "production");
        if (!mode) {
          context.addIssue({
            code: "custom",
            message:
              "CLOXA_PROXY_MODE must be vercel, none or append:<n> (required in production)",
          });
          return z.NEVER;
        }
        return mode;
      }),
    /** Cloudflare Turnstile on the login forms; on only when both keys are set. */
    TURNSTILE_SITE_KEY: z.string().min(1).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
  })
  // Half a Turnstile config is a mistake, not a way to switch it off.
  .refine(
    (value) =>
      (value.TURNSTILE_SITE_KEY === undefined) ===
      (value.TURNSTILE_SECRET_KEY === undefined),
    { message: "Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither" },
  )
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
  CLOXA_PROXY_MODE: process.env["CLOXA_PROXY_MODE"],
  TURNSTILE_SITE_KEY: process.env["TURNSTILE_SITE_KEY"] || undefined,
  TURNSTILE_SECRET_KEY: process.env["TURNSTILE_SECRET_KEY"] || undefined,
});

export const env = {
  ...publicEnv,
  ...serverOnlyEnv,
  TURNSTILE_ENABLED: turnstileEnabled({
    siteKey: serverOnlyEnv.TURNSTILE_SITE_KEY,
    secretKey: serverOnlyEnv.TURNSTILE_SECRET_KEY,
  }),
};

// Once per process (this module can be evaluated in more than one bundle).
const warned = Symbol.for("cloxa.proxyModeNoneWarned");
const flags = globalThis as { [warned]?: boolean };
if (env.CLOXA_PROXY_MODE.kind === "none" && !flags[warned]) {
  flags[warned] = true;
  console.warn(
    "CLOXA_PROXY_MODE=none: client IPs are unknown, so the per-IP auth limits are off",
  );
}
