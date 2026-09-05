"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { nlBE } from "@/i18n/nl-BE";
import { getAuthorizedPath, getAuthorizedPathWithReturn } from "@/lib/auth/access";
import { clearAuthFlowIntent, requireAuthFlow } from "@/lib/auth/flow-intent";
import { deliverEmployeeInvitation } from "@/lib/auth/invitation-delivery";
import { getLocalSiteOrigin } from "@/lib/auth/local-only";
import { getSafePostAuthPath } from "@/lib/auth/routes";
import { getAuthContext } from "@/lib/auth/session";
import {
  getFormText,
  invitationSchema,
  loginSchema,
  passwordSchema,
  recoverySchema,
  validationState,
  type AuthActionState,
} from "@/lib/auth/validation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function errorState(message: string): AuthActionState {
  return { message, status: "error" };
}

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = loginSchema.safeParse({
    email: getFormText(formData, "email"),
    password: getFormText(formData, "password"),
  });

  // Invalid credentials share one response; never relay Auth error details.
  if (!parsed.success) {
    return errorState(nlBE.auth.loginFailure);
  }

  let destination: Route;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signInWithPassword(parsed.data);

    if (error) {
      return errorState(nlBE.auth.loginFailure);
    }

    await clearAuthFlowIntent();
    const context = await getAuthContext(supabase);
    const requested = getSafePostAuthPath(
      getFormText(formData, "next"),
      context.state === "authorized" && context.role === "employee"
        ? "/employee"
        : "/manager",
    );
    destination = getAuthorizedPathWithReturn(context, requested);

    if (context.state === "authorized") {
      // A safe URL does not grant access to another role's workspace.
      destination =
        (context.role === "manager" && requested.startsWith("/manager")) ||
        (context.role === "employee" && requested === "/employee")
          ? requested
          : getAuthorizedPath(context);
    }
  } catch {
    return errorState(nlBE.auth.loginFailure);
  }

  // Next.js redirects throw; keep them outside provider error handling.
  redirect(destination);
}

export async function logoutAction(
  _previous: AuthActionState,
): Promise<AuthActionState> {
  void _previous;

  try {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      return errorState(nlBE.auth.logoutFailure);
    }

    await clearAuthFlowIntent();
  } catch {
    return errorState(nlBE.auth.logoutFailure);
  }

  redirect("/login");
}

export async function forgotPasswordAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = recoverySchema.safeParse({ email: getFormText(formData, "email") });

  if (!parsed.success) {
    return validationState(parsed.error);
  }

  try {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${getLocalSiteOrigin()}/auth/callback`,
    });
  } catch {
    // Identical reply for missing accounts, rate limits, and delivery failures.
  }

  return { message: nlBE.auth.recoverySuccess, status: "success" };
}

export async function inviteEmployeeAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  try {
    const supabase = await createSupabaseServerClient();
    const context = await getAuthContext(supabase);

    if (context.state !== "authorized" || context.role !== "manager") {
      return errorState(nlBE.auth.invitationFailure);
    }

    const parsed = invitationSchema.safeParse({
      email: getFormText(formData, "email"),
      displayName: getFormText(formData, "displayName"),
      employeeCode: getFormText(formData, "employeeCode"),
    });

    if (!parsed.success) {
      return validationState(parsed.error);
    }

    const { data, error } = await supabase.rpc("create_employee_invitation", {
      employee_email: parsed.data.email,
      ...(parsed.data.displayName === null
        ? {}
        : { display_name: parsed.data.displayName }),
      ...(parsed.data.employeeCode === null
        ? {}
        : { employee_code: parsed.data.employeeCode }),
    });

    if (error) {
      return errorState(nlBE.auth.invitationFailure);
    }

    if (data) {
      await deliverEmployeeInvitation(data);
    }
  } catch {
    return errorState(nlBE.auth.invitationFailure);
  }

  return { message: nlBE.auth.invitationSuccess, status: "success" };
}

export async function acceptInvitationAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  let destination: ReturnType<typeof getAuthorizedPath>;
  let failureMessage: string = nlBE.auth.invitationUnavailable;

  try {
    const supabase = await createSupabaseServerClient();

    if (!(await requireAuthFlow("invite", supabase))) {
      return errorState(nlBE.auth.invitationUnavailable);
    }

    const parsed = passwordSchema.safeParse({
      password: getFormText(formData, "password"),
      passwordConfirmation: getFormText(formData, "passwordConfirmation"),
    });

    if (!parsed.success) {
      return validationState(parsed.error);
    }

    const preflight = await supabase.rpc("get_employee_invitation_state");

    if (preflight.error || preflight.data !== "ready") {
      return errorState(nlBE.auth.invitationUnavailable);
    }

    failureMessage = nlBE.auth.passwordFailure;
    const passwordResult = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (passwordResult.error) {
      return errorState(nlBE.auth.passwordFailure);
    }

    failureMessage = nlBE.auth.invitationUnavailable;
    const acceptance = await supabase.rpc("accept_employee_invitation");

    if (acceptance.error || !acceptance.data) {
      return errorState(nlBE.auth.invitationUnavailable);
    }

    await clearAuthFlowIntent();
    destination = getAuthorizedPath(await getAuthContext(supabase));
  } catch {
    return errorState(failureMessage);
  }

  redirect(destination);
}

export async function resetPasswordAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  let destination: ReturnType<typeof getAuthorizedPath>;
  let failureMessage: string = nlBE.auth.recoveryUnavailable;

  try {
    const supabase = await createSupabaseServerClient();

    if (!(await requireAuthFlow("recovery", supabase))) {
      return errorState(nlBE.auth.recoveryUnavailable);
    }

    const parsed = passwordSchema.safeParse({
      password: getFormText(formData, "password"),
      passwordConfirmation: getFormText(formData, "passwordConfirmation"),
    });

    if (!parsed.success) {
      return validationState(parsed.error);
    }

    const resetContext = await getAuthContext(supabase);
    if (
      resetContext.state === "manager_mfa_verify" ||
      resetContext.state === "manager_mfa_recovery_required"
    ) {
      return errorState(nlBE.auth.passwordFailure);
    }
    const isManagerReset =
      (resetContext.state === "authorized" ||
        resetContext.state === "manager_mfa_setup") &&
      resetContext.role === "manager";

    failureMessage = nlBE.auth.passwordFailure;
    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
    });

    if (error) {
      return errorState(nlBE.auth.passwordFailure);
    }

    const signOut = await supabase.auth.signOut({
      scope: isManagerReset ? "global" : "others",
    });

    if (signOut.error) {
      return errorState(nlBE.auth.passwordFailure);
    }

    await clearAuthFlowIntent();
    destination = isManagerReset
      ? "/login"
      : getAuthorizedPath(await getAuthContext(supabase));
  } catch {
    return errorState(failureMessage);
  }

  redirect(destination);
}
