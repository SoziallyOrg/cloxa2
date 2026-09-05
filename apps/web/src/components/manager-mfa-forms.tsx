"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import {
  completeManagerMfaRecoveryEnrollmentAction,
  completeManagerMfaEnrollmentAction,
  startManagerMfaRecoveryEnrollmentAction,
  startManagerMfaEnrollmentAction,
  verifyManagerMfaPasswordRecoveryAction,
  verifyManagerMfaAction,
  type ManagerMfaEnrollmentState,
  type ManagerMfaVerificationState,
} from "@/lib/auth/manager-mfa-actions";

const initialEnrollment: ManagerMfaEnrollmentState = {
  message: "",
  status: "idle",
};
const initialVerification: ManagerMfaVerificationState = {
  message: "",
  status: "idle",
};

function CodeField() {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-semibold text-ink" htmlFor="code">
        {nlBE.managerMfa.codeLabel}
      </label>
      <input
        autoComplete="one-time-code"
        className="min-h-12 w-full min-w-0 rounded-xl border border-rule-strong bg-paper px-3 py-2 text-base tracking-[0.24em] text-ink caret-primary transition-colors hover:border-primary"
        id="code"
        inputMode="numeric"
        maxLength={6}
        minLength={6}
        name="code"
        pattern="[0-9]{6}"
        required
        type="text"
      />
      <p className="text-sm leading-6 text-muted">{nlBE.managerMfa.codeHelp}</p>
    </div>
  );
}

function FormMessage({ message }: { message: string }) {
  return message ? (
    <p className="text-sm leading-6 text-danger" role="alert">
      {message}
    </p>
  ) : null;
}

export function ManagerMfaSetupForm({ returnTo }: { returnTo: string }) {
  const [enrollment, start, starting] = useActionState(
    startManagerMfaEnrollmentAction,
    initialEnrollment,
  );
  const [verification, complete, completing] = useActionState(
    completeManagerMfaEnrollmentAction,
    initialVerification,
  );

  if (!enrollment.enrollment) {
    return (
      <form action={start} className="grid max-w-md gap-5">
        <p className="text-sm leading-6 text-muted">{nlBE.managerMfa.setupHelp}</p>
        <FormMessage message={enrollment.message} />
        <Button className="w-full sm:w-fit" disabled={starting} type="submit">
          {starting ? nlBE.auth.pending : nlBE.managerMfa.startSetup}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid max-w-md gap-6">
      <p className="text-sm leading-6 text-ink" role="status">
        {enrollment.message}
      </p>
      <div className="grid justify-items-start gap-3">
        {/* Provider QR contains setup secret. This page is private/no-store. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- private data URL cannot use Next image optimization */}
        <img
          alt={nlBE.managerMfa.qrAlt}
          className="size-52 max-w-full rounded-xl border border-rule-strong bg-white p-2"
          height={208}
          src={enrollment.enrollment.qrCode}
          width={208}
        />
        <p className="text-sm leading-6 text-muted">{nlBE.managerMfa.manualHelp}</p>
        <code className="max-w-full rounded-lg bg-paper-strong px-3 py-2 text-sm break-all text-ink">
          {enrollment.enrollment.secret}
        </code>
      </div>
      <form action={complete} className="grid gap-5">
        <input name="factorId" type="hidden" value={enrollment.enrollment.factorId} />
        <input name="returnTo" type="hidden" value={returnTo} />
        <CodeField />
        <FormMessage message={verification.message} />
        <Button className="w-full sm:w-fit" disabled={completing} type="submit">
          {completing ? nlBE.auth.pending : nlBE.managerMfa.completeSetup}
        </Button>
      </form>
    </div>
  );
}

export function ManagerMfaVerifyForm({ returnTo }: { returnTo: string }) {
  const [state, action, pending] = useActionState(
    verifyManagerMfaAction,
    initialVerification,
  );

  return (
    <form action={action} className="grid max-w-md gap-5">
      <input name="returnTo" type="hidden" value={returnTo} />
      <CodeField />
      <FormMessage message={state.message} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? nlBE.auth.pending : nlBE.managerMfa.verifySubmit}
      </Button>
    </form>
  );
}

export function ManagerMfaRecoveryForm({ caseId }: { caseId: string }) {
  const [enrollment, start, starting] = useActionState(
    startManagerMfaRecoveryEnrollmentAction,
    initialEnrollment,
  );
  const [verification, complete, completing] = useActionState(
    completeManagerMfaRecoveryEnrollmentAction,
    initialVerification,
  );

  if (verification.status === "awaiting_operator" && verification.candidateId) {
    return (
      <div className="grid max-w-md gap-3" role="status">
        <p className="text-sm leading-6 text-ink">{verification.message}</p>
        <p className="text-sm leading-6 text-muted">
          {nlBE.managerMfa.recoveryCandidateLabel}
        </p>
        <code className="max-w-full rounded-lg bg-paper-strong px-3 py-2 text-sm break-all text-ink">
          {verification.candidateId}
        </code>
      </div>
    );
  }

  if (!enrollment.enrollment) {
    return (
      <form action={start} className="grid max-w-md gap-5">
        <p className="text-sm leading-6 text-muted">
          {nlBE.managerMfa.recoveryActiveHelp}
        </p>
        <FormMessage message={enrollment.message} />
        <Button className="w-full sm:w-fit" disabled={starting} type="submit">
          {starting ? nlBE.auth.pending : nlBE.managerMfa.recoveryStartEnrollment}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid max-w-md gap-6">
      <p className="text-sm leading-6 text-ink" role="status">
        {enrollment.message}
      </p>
      <div className="grid justify-items-start gap-3">
        {/* Native provider QR contains setup secret. Route is private/no-store. */}
        {/* eslint-disable-next-line @next/next/no-img-element -- private data URL cannot use Next image optimization */}
        <img
          alt={nlBE.managerMfa.qrAlt}
          className="size-52 max-w-full rounded-xl border border-rule-strong bg-white p-2"
          height={208}
          src={enrollment.enrollment.qrCode}
          width={208}
        />
        <p className="text-sm leading-6 text-muted">{nlBE.managerMfa.manualHelp}</p>
        <code className="max-w-full rounded-lg bg-paper-strong px-3 py-2 text-sm break-all text-ink">
          {enrollment.enrollment.secret}
        </code>
      </div>
      <form action={complete} className="grid gap-5">
        <input name="caseId" type="hidden" value={caseId} />
        <input name="factorId" type="hidden" value={enrollment.enrollment.factorId} />
        <CodeField />
        <FormMessage message={verification.message} />
        <Button className="w-full sm:w-fit" disabled={completing} type="submit">
          {completing ? nlBE.auth.pending : nlBE.managerMfa.completeSetup}
        </Button>
      </form>
    </div>
  );
}

export function ManagerMfaPasswordRecoveryVerifyForm() {
  const [state, action, pending] = useActionState(
    verifyManagerMfaPasswordRecoveryAction,
    initialVerification,
  );

  return (
    <form action={action} className="grid max-w-md gap-5">
      <p className="text-sm leading-6 text-muted">
        {nlBE.managerMfa.passwordRecoveryVerifyHelp}
      </p>
      <CodeField />
      <FormMessage message={state.message} />
      <Button className="w-full sm:w-fit" disabled={pending} type="submit">
        {pending ? nlBE.auth.pending : nlBE.managerMfa.verifySubmit}
      </Button>
    </form>
  );
}
