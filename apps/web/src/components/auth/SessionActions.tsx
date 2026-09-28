import { t } from "@cloxa/i18n";

import { Button } from "@/components/ui/Button";
import { Stack } from "@/components/ui/Stack";
import { logout, logoutEverywhere } from "@/lib/auth/actions/session";

export interface SessionActionsProps {
  /** Also offer "sign out on all devices" (for a lost phone). */
  everywhere?: boolean;
}

/** Logout is always a POST (server action), never a GET link. */
export function SessionActions({ everywhere = false }: SessionActionsProps) {
  return (
    <Stack gap="md">
      <form action={logout}>
        <Button type="submit" variant="secondary">
          {t("session.logout")}
        </Button>
      </form>
      {everywhere ? (
        <form action={logoutEverywhere}>
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
