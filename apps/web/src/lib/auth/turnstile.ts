import "server-only";

import { z } from "zod";

import { env } from "@/lib/env.server";

import { requestClientIp } from "./limiter";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** Name of the hidden field the widget adds to the form. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/** Widget actions, checked on the server so a token for one form can't be replayed on another. */
export type TurnstileAction = "login" | "confirm";

export type TurnstileResult = "ok" | "failed" | "unavailable";

const siteverifyResponse = z.object({
  success: z.boolean(),
  action: z.string().optional(),
});

/** The public site key for the widget, or null when Turnstile is off. */
export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_ENABLED ? (env.TURNSTILE_SITE_KEY ?? null) : null;
}

/** Pure: whether a siteverify answer accepts the token for this action. */
export function acceptsTurnstile(body: unknown, action: TurnstileAction): boolean {
  const parsed = siteverifyResponse.safeParse(body);
  return parsed.success && parsed.data.success && parsed.data.action === action;
}

/**
 * Checks the Turnstile token of a submitted form with Cloudflare. Always "ok"
 * when Turnstile is off. Runs before the attempt limiter, so bots cannot use
 * up a real person's limits.
 */
export async function verifyTurnstile(
  formData: FormData,
  action: TurnstileAction,
): Promise<TurnstileResult> {
  if (!env.TURNSTILE_ENABLED || !env.TURNSTILE_SECRET_KEY) return "ok";

  const token = formData.get(TURNSTILE_FIELD);
  if (typeof token !== "string" || token === "" || token.length > 2048) return "failed";

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token,
  });
  const ip = await requestClientIp();
  if (ip) body.set("remoteip", ip);

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!response.ok) {
      console.error("turnstile_verify_failed", response.status);
      return "unavailable";
    }
    return acceptsTurnstile(await response.json(), action) ? "ok" : "failed";
  } catch (error) {
    console.error("turnstile_verify_failed", (error as Error).name);
    return "unavailable";
  }
}
