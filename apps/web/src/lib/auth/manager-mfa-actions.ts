"use server";

import { redirect } from "next/navigation";

import { nlBE } from "@/i18n/nl-BE";
import { getSafeManagerReturnPath } from "@/lib/auth/routes";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";

type EnrollmentDetails = {
  factorId: string;
  qrCode: string;
  secret: string;
};

export type ManagerMfaEnrollmentState = {
  status: "idle" | "error" | "ready";
  message: string;
  enrollment?: EnrollmentDetails;
};

export type ManagerMfaVerificationState = {
  status: "idle" | "error";
  message: string;
};

function enrollmentError(): ManagerMfaEnrollmentState {
  return { message: nlBE.managerMfa.genericFailure, status: "error" };
}

function verificationError(): ManagerMfaVerificationState {
  return { message: nlBE.managerMfa.genericFailure, status: "error" };
}

function isFactorId(value: FormDataEntryValue | null): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
  );
}

function getCode(formData: FormData): string | null {
  const value = formData.get("code");
  return typeof value === "string" && /^\d{6}$/u.test(value.trim())
    ? value.trim()
    : null;
}

export async function startManagerMfaEnrollmentAction(
  _previous: ManagerMfaEnrollmentState,
): Promise<ManagerMfaEnrollmentState> {
  void _previous;

  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);

    if (context.state !== "manager_mfa_setup") {
      return enrollmentError();
    }

    const result = await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Cloxa manager",
      issuer: "Cloxa",
    });
    const factor = result.data;

    if (
      result.error ||
      !factor ||
      factor.type !== "totp" ||
      !isFactorId(factor.id) ||
      !factor.totp.qr_code.startsWith("data:image/svg+xml") ||
      !/^[A-Z2-7]+=*$/iu.test(factor.totp.secret) ||
      factor.totp.secret.length > 256
    ) {
      return enrollmentError();
    }

    return {
      enrollment: {
        factorId: factor.id,
        qrCode: factor.totp.qr_code,
        secret: factor.totp.secret,
      },
      message: nlBE.managerMfa.enrollmentReady,
      status: "ready",
    };
  } catch {
    return enrollmentError();
  }
}

export async function completeManagerMfaEnrollmentAction(
  _previous: ManagerMfaVerificationState,
  formData: FormData,
): Promise<ManagerMfaVerificationState> {
  const factorId = formData.get("factorId");
  const code = getCode(formData);
  const returnTo = getSafeManagerReturnPath(
    typeof formData.get("returnTo") === "string"
      ? String(formData.get("returnTo"))
      : null,
  );

  if (!isFactorId(factorId) || !code) {
    return verificationError();
  }

  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);

    if (context.state !== "manager_mfa_setup") {
      return verificationError();
    }

    const factors = await supabase.auth.mfa.listFactors();
    const pendingFactor = factors.data?.all.find(
      (factor) =>
        factor.id === factorId &&
        factor.factor_type === "totp" &&
        factor.status === "unverified",
    );

    if (factors.error || !pendingFactor) {
      return verificationError();
    }

    const challenge = await supabase.auth.mfa.challenge({ factorId });

    if (challenge.error) {
      return verificationError();
    }

    const verification = await supabase.auth.mfa.verify({
      challengeId: challenge.data.id,
      code,
      factorId,
    });

    if (verification.error) {
      return verificationError();
    }

    const registration = await supabase.rpc("register_manager_mfa");

    if (registration.error || registration.data !== "ready") {
      return verificationError();
    }

    const ready = await getAuthContext(supabase);

    if (ready.state !== "authorized" || ready.role !== "manager") {
      return verificationError();
    }
  } catch {
    return verificationError();
  }

  redirect(returnTo);
}

export async function verifyManagerMfaAction(
  _previous: ManagerMfaVerificationState,
  formData: FormData,
): Promise<ManagerMfaVerificationState> {
  const code = getCode(formData);
  const returnTo = getSafeManagerReturnPath(
    typeof formData.get("returnTo") === "string"
      ? String(formData.get("returnTo"))
      : null,
  );

  if (!code) {
    return verificationError();
  }

  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);

    if (context.state !== "manager_mfa_verify" || !context.factorId) {
      return verificationError();
    }

    const challenge = await supabase.auth.mfa.challenge({
      factorId: context.factorId,
    });

    if (challenge.error) {
      return verificationError();
    }

    const verification = await supabase.auth.mfa.verify({
      challengeId: challenge.data.id,
      code,
      factorId: context.factorId,
    });

    if (verification.error) {
      return verificationError();
    }

    const ready = await getAuthContext(supabase);

    if (ready.state !== "authorized" || ready.role !== "manager") {
      return verificationError();
    }
  } catch {
    return verificationError();
  }

  redirect(returnTo);
}
