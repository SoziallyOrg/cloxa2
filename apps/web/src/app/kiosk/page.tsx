import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { kioskRoster, type KioskRosterEntry } from "@cloxa/db";
import { t } from "@cloxa/i18n";

import { KioskScreen } from "@/components/kiosk/KioskScreen";
import { AutoRefresh } from "@/components/manage/AutoRefresh";
import { Button, buttonClassName } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { readKioskSecret } from "@/lib/kiosk/device-cookie";
import { kioskFailureCode } from "@/lib/kiosk/errors";
import { createAnonClient } from "@/lib/supabase/server";

import { forgetKioskAction } from "./actions";

const PAUSED_REFRESH_MS = 60_000;

function Message({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-6 p-6">
      <Heading level={1}>{title}</Heading>
      <p className="text-lg">{body}</p>
      {children}
    </main>
  );
}

/**
 * The shared tablet. Only the device secret (cookie `cx_kiosk`) identifies
 * it, and every call goes through the anon client, so a login in the same
 * browser changes nothing here.
 */
export default async function KioskPage() {
  const deviceSecret = await readKioskSecret();
  if (deviceSecret === null) {
    return (
      <Message title={t("kiosk.unpairedTitle")} body={t("kiosk.unpairedBody")}>
        <Link
          href={"/kiosk/koppelen" as Route}
          className={buttonClassName("primary", "lg")}
        >
          {t("kiosk.unpairedAction")}
        </Link>
      </Message>
    );
  }

  let roster: KioskRosterEntry[];
  try {
    roster = await kioskRoster(createAnonClient(), { deviceSecret });
  } catch (error) {
    const code = kioskFailureCode(error);
    if (code === "device_unknown") {
      // Server Components cannot delete cookies; the button's action does.
      return (
        <Message title={t("kiosk.revokedTitle")} body={t("kiosk.revokedBody")}>
          <form action={forgetKioskAction}>
            <Button type="submit" size="lg">
              {t("kiosk.revokedAction")}
            </Button>
          </form>
        </Message>
      );
    }
    if (code === "device_paused") {
      return (
        <Message title={t("kiosk.pausedTitle")} body={t("kiosk.pausedBody")}>
          <AutoRefresh intervalMs={PAUSED_REFRESH_MS} />
        </Message>
      );
    }
    throw error;
  }

  return (
    <main className="min-h-screen">
      <KioskScreen
        employees={roster.map((entry) => ({
          id: entry.employeeId,
          name: entry.displayName,
          initials: entry.initials,
          hasPin: entry.hasPin,
        }))}
      />
    </main>
  );
}
