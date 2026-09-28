"use server";

import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { env } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

import { COOKIE, FLOW_TTL_SECONDS } from "../cookies";
import { parseSixDigitCode, type FormState } from "../form-state";
import { normalizeEmail } from "../hash";
import { recordAttempt, resetAttempts, retryMinutes } from "../limiter";
import { safeNextPath } from "../redirects";
import { deleteCloxaCookie, setCloxaCookie } from "../server-cookies";
import { mintFlow, readFlow } from "../session-cookies";

/**
 * Step 1: send a code. Whatever happens after the email passes validation
 * (unknown address, limiter block, Supabase error) the user sees the same
 * next screen, so the form cannot be used to find out who has an account.
 */
export async function requestCode(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = normalizeEmail(formData.get("email"));
  if (!email) return { error: t("login.emailInvalid") };
  const next = safeNextPath(formData.get("next"));

  const attempt = await recordAttempt("otp_request", email);
  if (attempt.kind === "unavailable") return { error: t("login.unavailable") };

  if (attempt.kind === "allowed") {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL("/auth/confirm", env.CLOXA_SITE_URL).toString(),
      },
    });
    // Unknown addresses fail here by design; log only the code, never the address.
    if (error && error.code !== "otp_disabled" && error.code !== "user_not_found") {
      console.error("otp_request_failed", error.code ?? error.status);
    }
  }

  await setCloxaCookie(
    COOKIE.flow,
    mintFlow({ email, next }, env.FLOW_COOKIE_SECRET),
    FLOW_TTL_SECONDS,
  );
  redirect("/login/code");
}

/** Step 2: check the code from the email. */
export async function verifyCode(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const cookieStore = await cookies();
  const flow = readFlow(cookieStore.get(COOKIE.flow)?.value, env.FLOW_COOKIE_SECRET);
  if (!flow) redirect("/login");

  const code = parseSixDigitCode(formData.get("code"));
  if (!code) return { error: t("loginCode.format") };

  const attempt = await recordAttempt("otp_verify", flow.email);
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

  await resetAttempts(flow.email);
  await deleteCloxaCookie(COOKIE.flow);
  redirect((safeNextPath(flow.next) ?? "/start") as Route);
}
