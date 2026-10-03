"use client";

import { useState, useTransition } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";

import { t } from "@cloxa/i18n";

import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Row, Section } from "@/components/ui/List";
import { logout, logoutEverywhere } from "@/lib/auth/actions/session";
import { clearShellCache } from "@/lib/offline/browser";
import { signOutDecision } from "@/lib/offline/sign-out";

type Scope = "local" | "global";

async function signOutNow(scope: Scope): Promise<void> {
  // Before the server action: it redirects, and the next person on a
  // shared phone must not get this person's cached /app screen.
  await clearShellCache();
  await (scope === "global" ? logoutEverywhere() : logout());
}

export interface SessionActionsProps {
  /** Also offer "sign out on all devices" (for a lost phone). */
  everywhere?: boolean;
  /** Clock actions still queued on this device (employee app only). */
  pendingCount?: number;
}

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
    await signOutNow(scope);
  }

  if (warning !== null) {
    return (
      <div className="flex flex-col gap-4">
        <p role="alert" className="text-body font-medium">
          {t("offline.signOutWarning", { count: pendingCount })}
        </p>
        <form action={(formData) => signOut(warning, formData)} className="contents">
          <input type="hidden" name="confirm" value="1" />
          <Button type="submit" variant="danger" wide>
            {t("offline.signOutAnyway")}
          </Button>
        </form>
        <Button type="button" variant="secondary" wide onClick={() => setWarning(null)}>
          {t("offline.signOutCancel")}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <form action={(formData) => signOut("local", formData)}>
        <Button type="submit" variant="secondary" wide>
          {t("session.logout")}
        </Button>
      </form>
      {everywhere ? (
        <form
          action={(formData) => signOut("global", formData)}
          className="flex flex-col items-center gap-1"
        >
          <Button type="submit" variant="plain">
            {t("session.logoutEverywhere")}
          </Button>
          <p className="text-center text-subhead text-ink-2">
            {t("session.logoutEverywhereHint")}
          </p>
        </form>
      ) : null}
    </div>
  );
}

export interface SessionRowsProps {
  /** Reads how many actions are still queued, right when a row is pressed. */
  queuedCount: () => Promise<number>;
}

/**
 * "Afmelden" and "Overal afmelden" as an inset grouped section (Instellingen
 * and the account sheet). With actions still queued on the device, an alert
 * warns first.
 */
export function SessionRows({ queuedCount }: SessionRowsProps) {
  const [warning, setWarning] = useState<{ scope: Scope; count: number } | null>(null);
  const [pending, startTransition] = useTransition();

  function press(scope: Scope) {
    startTransition(async () => {
      const count = await queuedCount();
      if (signOutDecision(count, false) === "warn") {
        setWarning({ scope, count });
        return;
      }
      await signOutNow(scope);
    });
  }

  return (
    <>
      <Section footer={t("session.logoutEverywhereHint")}>
        <Row
          icon={LogOut}
          title={t("session.logout")}
          disabled={pending}
          aria-busy={pending || undefined}
          onClick={() => press("local")}
        />
        <Row
          icon={MonitorSmartphone}
          title={t("session.logoutEverywhere")}
          disabled={pending}
          onClick={() => press("global")}
        />
      </Section>
      <Alert
        open={warning !== null}
        onClose={() => setWarning(null)}
        title={t("session.logout")}
        message={warning ? t("offline.signOutWarning", { count: warning.count }) : ""}
        confirmLabel={t("offline.signOutAnyway")}
        cancelLabel={t("offline.signOutCancel")}
        destructive
        onConfirm={() => {
          const scope = warning?.scope ?? "local";
          startTransition(() => signOutNow(scope));
        }}
      />
    </>
  );
}
