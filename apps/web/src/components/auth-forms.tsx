"use client";

import { useActionState, type InputHTMLAttributes } from "react";

import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import {
  acceptInvitationAction,
  forgotPasswordAction,
  inviteEmployeeAction,
  loginAction,
  resetPasswordAction,
} from "@/lib/auth/actions";
import type { AuthActionState, AuthFormField } from "@/lib/auth/validation";

const initialState: AuthActionState = { message: "", status: "idle" };

function FormField({
  help,
  label,
  name,
  state,
  ...input
}: InputHTMLAttributes<HTMLInputElement> & {
  help?: string;
  label: string;
  name: AuthFormField;
  state: AuthActionState;
}) {
  const error = state.fieldErrors?.[name];
  const describedBy = [help ? `${name}-help` : null, error ? `${name}-error` : null]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="grid gap-2">
      <label className="text-sm font-semibold text-ink" htmlFor={name}>
        {label}
      </label>
      <input
        {...input}
        aria-describedby={describedBy || undefined}
        aria-invalid={Boolean(error)}
        className="min-h-12 w-full min-w-0 rounded-xl border border-rule-strong bg-paper px-3 py-2 text-base text-ink caret-primary transition-colors hover:border-primary disabled:opacity-55"
        id={name}
        name={name}
      />
      {help ? (
        <p className="text-sm leading-6 text-muted" id={`${name}-help`}>
          {help}
        </p>
      ) : null}
      {error ? (
        <p className="text-sm leading-6 text-danger" id={`${name}-error`}>
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FormMessage({ state }: { state: AuthActionState }) {
  if (!state.message) {
    return null;
  }

  return (
    <p
      className={
        state.status === "error"
          ? "text-sm leading-6 text-danger"
          : "text-sm leading-6 text-ink"
      }
      role={state.status === "error" ? "alert" : "status"}
    >
      {state.message}
    </p>
  );
}

export function LoginForm({
  next,
  callbackFailed,
}: {
  next: string;
  callbackFailed: boolean;
}) {
  const [state, action, pending] = useActionState(loginAction, initialState);

  return (
    <form action={action} className="grid max-w-md gap-5">
      <input name="next" type="hidden" value={next} />
      <FormField
        autoComplete="email"
        label={nlBE.auth.email}
        maxLength={254}
        name="email"
        required
        state={state}
        type="email"
      />
      <FormField
        autoComplete="current-password"
        label={nlBE.auth.password}
        maxLength={128}
        name="password"
        required
        state={state}
        type="password"
      />
      {callbackFailed && state.status === "idle" ? (
        <p className="text-sm leading-6 text-danger" role="alert">
          {nlBE.auth.loginFailure}
        </p>
      ) : null}
      <FormMessage state={state} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? nlBE.auth.pending : nlBE.auth.loginSubmit}
      </Button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, initialState);

  return (
    <form action={action} className="grid max-w-md gap-5">
      <FormField
        autoComplete="email"
        label={nlBE.auth.email}
        maxLength={254}
        name="email"
        required
        state={state}
        type="email"
      />
      <FormMessage state={state} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? nlBE.auth.pending : nlBE.auth.recoverySubmit}
      </Button>
    </form>
  );
}

export function EmployeeInvitationForm() {
  const [state, action, pending] = useActionState(inviteEmployeeAction, initialState);

  return (
    <form action={action} className="mt-6 grid max-w-md gap-5">
      <FormField
        autoComplete="off"
        label={nlBE.invitation.email}
        maxLength={254}
        name="email"
        required
        state={state}
        type="email"
      />
      <FormField
        autoComplete="off"
        label={nlBE.invitation.displayName}
        maxLength={100}
        name="displayName"
        state={state}
        type="text"
      />
      <FormField
        autoComplete="off"
        label={nlBE.invitation.employeeCode}
        maxLength={32}
        name="employeeCode"
        state={state}
        type="text"
      />
      <FormMessage state={state} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? nlBE.auth.pending : nlBE.invitation.submit}
      </Button>
    </form>
  );
}

export function PasswordForm({ purpose }: { purpose: "invite" | "recovery" }) {
  const [state, action, pending] = useActionState(
    purpose === "invite" ? acceptInvitationAction : resetPasswordAction,
    initialState,
  );
  const submit =
    purpose === "invite" ? nlBE.acceptInvitation.submit : nlBE.resetPassword.submit;

  return (
    <form action={action} className="grid max-w-md gap-5">
      <FormField
        autoComplete="new-password"
        help={nlBE.auth.passwordHelp}
        label={nlBE.auth.newPassword}
        maxLength={128}
        minLength={12}
        name="password"
        required
        state={state}
        type="password"
      />
      <FormField
        autoComplete="new-password"
        label={nlBE.auth.passwordConfirmation}
        maxLength={128}
        minLength={12}
        name="passwordConfirmation"
        required
        state={state}
        type="password"
      />
      <FormMessage state={state} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? nlBE.auth.pending : submit}
      </Button>
    </form>
  );
}
