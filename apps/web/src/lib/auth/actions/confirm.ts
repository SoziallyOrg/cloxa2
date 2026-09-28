"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { createClient } from "@/lib/supabase/server";

import type { FormState } from "../form-state";
import { checkLinkVerify, recordLinkFailure, retryMinutes } from "../limiter";
import { parseConfirmType, parseTokenHash, safeNextPath } from "../redirects";
import { verifyTurnstile } from "../turnstile";

/**
 * POST half of `/auth/confirm`: exchanges an email link's `token_hash` for
 * session cookies. Only a deliberate button press (a same-origin server
 * action) spends the token, so mail scanners that prefetch links and
 * cross-site "login CSRF" pages cannot. Only failures count: 30 per client
 * IP, and past 300 overall link sign-in pauses for everyone (people then use
 * the code from the same email, which has its own limits).
 */
export async function confirmEmailLink(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tokenHash = parseTokenHash(formData.get("token_hash"));
  const type = parseConfirmType(formData.get("type"));
  const next = safeNextPath(formData.get("next")) ?? "/start";
  if (!tokenHash || !type) redirect("/login?fout=link");

  const human = await verifyTurnstile(formData, "confirm");
  if (human === "unavailable") return { error: t("login.unavailable") };
  if (human === "failed") return { error: t("auth.turnstile.failed") };

  const attempt = await checkLinkVerify();
  if (attempt.kind === "unavailable") return { error: t("login.unavailable") };
  if (attempt.kind === "paused") return { error: t("auth.confirm.paused") };
  if (attempt.kind === "blocked") {
    return {
      error: t("loginCode.blocked", {
        minutes: retryMinutes(attempt.retryAfterSeconds),
      }),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) {
    await recordLinkFailure();
    redirect("/login?fout=link");
  }

  // Passwordless app: a recovery link simply signs the user in.
  redirect(next as Route);
}
