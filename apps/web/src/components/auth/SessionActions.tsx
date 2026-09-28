"use client";

import { useState } from "react";

import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { logout, logoutEverywhere } from "@/lib/auth/actions/session";
import { clearShellCache } from "@/lib/offline/browser";
import { signOutDecision } from "@/lib/offline/sign-out";

export interface SessionActionsProps {
  /** Also offer "sign out on all devices" (for a lost phone). */
  everywhere?: boolean;
  /** Clock actions still queued on this device (employee app only). */
  pendingCount?: number;
}

type Scope = "local" | "global";

/** Logout is always a POST (server action), never a GET link. */
export function SessionActions({
  everywhere = false,
  pendingCount = 0,
}: SessionActionsProps) {
  const [warning, setWarning] = useState<Scope | null>(null);

  async function signOut(scope: Scope, formData: FormData): Promise<void> {
    if (signOutDecision(pendingCount, formData.get("confirm") === "1") === "warn") {
      setWarning(scope);
      return;
    }
    // Before the server action: it redirects, and the next person on a
    // shared phone must not get this person's cached /app screen.
    await clearShellCache();
    await (scope === "global" ? logoutEverywhere() : logout());
  }

  if (warning !== null) {
    return (
      <Stack gap="md">
        <p role="alert" className="text-lg font-semibold">
          {t("offline.signOutWarning", { count: pendingCount })}
        </p>
        <form action={(formData) => signOut(warning, formData)}>
          <input type="hidden" name="confirm" value="1" />
          <Button type="submit" variant="secondary">
            {t("offline.signOutAnyway")}
          </Button>
        </form>
        <div>
          <Button type="button" variant="quiet" onClick={() => setWarning(null)}>
            {t("offline.signOutCancel")}
          </Button>
        </div>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <form action={(formData) => signOut("local", formData)}>
        <Button type="submit" variant="secondary">
          {t("session.logout")}
        </Button>
      </form>
      {everywhere ? (
        <form action={(formData) => signOut("global", formData)}>
          <Stack gap="sm">
            <p className="text-base text-ink/70">{t("session.logoutEverywhereHint")}</p>
            <div>
              <Button type="submit" variant="quiet">
                {t("session.logoutEverywhere")}
              </Button>
            </div>
          </Stack>
        </form>
      ) : null}
    </Stack>
  );
}
