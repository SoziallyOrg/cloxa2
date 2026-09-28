"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { createClient } from "@/lib/supabase/server";

import type { FormState } from "../form-state";
import { recordLinkVerify, retryMinutes } from "../limiter";
import { parseConfirmType, parseTokenHash, safeNextPath } from "../redirects";

/**
 * POST half of `/auth/confirm`: exchanges an email link's `token_hash` for
 * session cookies. Only a deliberate button press (a same-origin server
 * action) spends the token, so mail scanners that prefetch links and
 * cross-site "login CSRF" pages cannot. Rate limited per client IP.
 */
export async function confirmEmailLink(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const tokenHash = parseTokenHash(formData.get("token_hash"));
  const type = parseConfirmType(formData.get("type"));
  const next = safeNextPath(formData.get("next")) ?? "/start";
  if (!tokenHash || !type) redirect("/login?fout=link");

  const attempt = await recordLinkVerify();
  if (attempt.kind === "unavailable") return { error: t("login.unavailable") };
  if (attempt.kind === "blocked") {
    return {
      error: t("loginCode.blocked", {
        minutes: retryMinutes(attempt.retryAfterSeconds),
      }),
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error) redirect("/login?fout=link");

  // Passwordless app: a recovery link simply signs the user in.
  redirect(next as Route);
}
