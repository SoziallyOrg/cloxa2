"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";
import { logoutAction } from "@/lib/auth/actions";
import type { AuthActionState } from "@/lib/auth/validation";

const initialState: AuthActionState = { message: "", status: "idle" };

export function LogoutForm() {
  const [state, action, pending] = useActionState(logoutAction, initialState);

  return (
    <form action={action} className="grid gap-2">
      <Button disabled={pending} type="submit" variant="secondary">
        {pending ? nlBE.auth.pending : nlBE.auth.logout}
      </Button>
      {state.message ? (
        <p className="max-w-xs text-sm leading-6 text-danger" role="alert">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
