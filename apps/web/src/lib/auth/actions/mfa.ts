"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { t } from "@cloxa/i18n";

import { env } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

import { requirePrivilegedRole, type MemberContext } from "../context";
import { COOKIE } from "../cookies";
import { parseSixDigitCode, type EnrolState, type FormState } from "../form-state";
import { normalizeEmail } from "../hash";
import { recordAttempt, resetAttempts, retryMinutes } from "../limiter";
import { IDLE_TIMEOUT_SECONDS } from "../mfa";
import { setCloxaCookie } from "../server-cookies";
import { mintActivity } from "../session-cookies";

/**
 * TOTP codes are only 6 digits and Supabase sees our server's IP, so every
 * check also goes through the attempt limiter, keyed on the user's email.
 */
function limiterKey(context: MemberContext): string {
  return normalizeEmail(context.claims.email) ?? `user:${context.claims.userId}`;
}

async function limited(context: MemberContext): Promise<FormState | null> {
  const attempt = await recordAttempt("otp_verify", limiterKey(context));
  if (attempt.kind === "unavailable") return { error: t("login.unavailable") };
  if (attempt.kind === "blocked") {
    return {
      error: t("loginCode.blocked", {
        minutes: retryMinutes(attempt.retryAfterSeconds),
      }),
    };
  }
  return null;
}

/** A verified factor starts the idle clock and lands the manager in `/manage`. */
async function finishVerification(context: MemberContext): Promise<never> {
  await resetAttempts(limiterKey(context));
  await setCloxaCookie(
    COOKIE.activity,
    mintActivity(context.claims.userId, env.FLOW_COOKIE_SECRET),
    IDLE_TIMEOUT_SECONDS,
  );
  redirect("/manage");
}

/** Creates a fresh TOTP factor and returns its QR code and secret. */
export async function startEnrolment(): Promise<EnrolState> {
  await requirePrivilegedRole();
  const supabase = await createClient();

  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: t("mfa.setupFailed"), enrolment: null };
  if (factors.totp.some((factor) => factor.status === "verified")) {
    redirect("/manage/beveiliging/controle");
  }

  // Abandoned attempts leave unverified factors behind; start clean.
  for (const factor of factors.all) {
    if (factor.factor_type === "totp" && factor.status === "unverified") {
      await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
  }

  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    issuer: "Cloxa",
    friendlyName: "Cloxa",
  });
  if (error) {
    console.error("mfa_enroll_failed", error.code ?? error.status);
    return { error: t("mfa.setupFailed"), enrolment: null };
  }

  return {
    error: null,
    enrolment: {
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    },
  };
}

const factorId = z.uuid();

/** Confirms the new factor with a first code; the session becomes aal2. */
export async function confirmEnrolment(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requirePrivilegedRole();
  const id = factorId.safeParse(formData.get("factorId"));
  const code = parseSixDigitCode(formData.get("code"));
  if (!id.success) return { error: t("mfa.setupFailed") };
  if (!code) return { error: t("loginCode.format") };

  const blocked = await limited(context);
  if (blocked) return blocked;

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: id.data,
    code,
  });
  if (error) return { error: t("mfa.invalid") };

  return finishVerification(context);
}

/** Re-verifies an existing factor: aal1 → aal2, or a fresh MFA timestamp. */
export async function verifyTotp(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const context = await requirePrivilegedRole();
  const code = parseSixDigitCode(formData.get("code"));
  if (!code) return { error: t("loginCode.format") };

  const supabase = await createClient();
  const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
  if (listError) return { error: t("login.unavailable") };
  const factor = factors.totp.find((candidate) => candidate.status === "verified");
  if (!factor) redirect("/manage/beveiliging/instellen");

  const blocked = await limited(context);
  if (blocked) return blocked;

  const { error } = await supabase.auth.mfa.challengeAndVerify({
    factorId: factor.id,
    code,
  });
  if (error) return { error: t("mfa.invalid") };

  return finishVerification(context);
}
