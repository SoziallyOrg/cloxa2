"use server";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { t } from "@cloxa/i18n";

import { env } from "@/lib/env.server";
import { createClient, createOtpSender } from "@/lib/supabase/server";

import { COOKIE, FLOW_TTL_SECONDS } from "../cookies";
import { parseSixDigitCode, type FormState } from "../form-state";
import { normalizeEmail } from "../hash";
import {
  recordOtpRequest,
  recordOtpVerify,
  requestClientIp,
  resetEmailAttempts,
  retryMinutes,
} from "../limiter";
import { safeNextPath } from "../redirects";
import { deleteCloxaCookie, setCloxaCookie } from "../server-cookies";
import { mintFlow, newFlowNonce, readFlow } from "../session-cookies";
import { verifyTurnstile } from "../turnstile";

/**
 * Step 1: send a code. After the email passes validation the user always
 * lands on the same code screen, whether the address is known, unknown or
 * rate limited:
 * - the limiter does the same database work for every address;
 * - the email itself is sent in `after()`, so the response never waits for
 *   Supabase or SMTP (no timing difference between known and unknown);
 * - a blocked request gets no flow cookie, so it cannot start new flows, and
 *   any code typed on that screen is simply "wrong or expired".
 */
export async function requestCode(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = normalizeEmail(formData.get("email"));
  if (!email) return { error: t("login.emailInvalid") };
  const next = safeNextPath(formData.get("next"));

  // Before the limiter: bots must not use up a real person's request budget.
  const human = await verifyTurnstile(formData, "login");
  if (human === "unavailable") return { error: t("login.unavailable") };
  if (human === "failed") return { error: t("auth.turnstile.failed") };

  const attempt = await recordOtpRequest(email);
  if (attempt.kind === "unavailable") return { error: t("login.unavailable") };

  if (attempt.kind === "allowed") {
    const clientIp = await requestClientIp();
    after(async () => {
      const { error } = await createOtpSender(clientIp).auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      // Unknown addresses fail here by design; log only the code, never the address.
      if (error && error.code !== "otp_disabled" && error.code !== "user_not_found") {
        console.error("otp_request_failed", error.code ?? error.status);
      }
    });

    await setCloxaCookie(
      COOKIE.flow,
      mintFlow({ email, next, nonce: newFlowNonce() }, env.FLOW_COOKIE_SECRET),
      FLOW_TTL_SECONDS,
    );
  }

  redirect("/login/code");
}

/** Step 2: check the code from the email. */
export async function verifyCode(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const code = parseSixDigitCode(formData.get("code"));
  if (!code) return { error: t("loginCode.format") };

  const cookieStore = await cookies();
  const flow = readFlow(cookieStore.get(COOKIE.flow)?.value, env.FLOW_COOKIE_SECRET);
  // No flow (expired, or the request was rate limited): indistinguishable from a wrong code.
  if (!flow) return { error: t("loginCode.invalid") };

  const attempt = await recordOtpVerify(flow.email, flow.nonce);
  if (attempt.kind === "unavailable") return { error: t("login.unavailable") };
  if (attempt.kind === "blocked") {
    return {
      error: t("loginCode.blocked", {
        minutes: retryMinutes(attempt.retryAfterSeconds),
      }),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({
    email: flow.email,
    token: code,
    type: "email",
  });
  if (error) return { error: t("loginCode.invalid") };

  await resetEmailAttempts(flow.email);
  await deleteCloxaCookie(COOKIE.flow);
  redirect((safeNextPath(flow.next) ?? "/start") as Route);
}
