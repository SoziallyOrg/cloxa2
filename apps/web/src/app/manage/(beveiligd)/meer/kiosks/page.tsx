import { redirect } from "next/navigation";
import { Tablet } from "lucide-react";

import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { KioskRow, KioskTableRow, NewKiosk } from "@/components/manage/KioskSheets";
import { DataHead, DataTable, Th } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { env } from "@/lib/env.server";
import { previewHold } from "@/lib/preview";
import { createClient } from "@/lib/supabase/server";

import { createKioskAction, newPairingCodeAction, revokeKioskAction } from "./actions";

interface DeviceRow {
  id: string;
  site_id: string;
  name: string;
  status: string;
  last_seen_at: string | null;
  paused_until: string | null;
}

function deviceStatus(device: DeviceRow, now: number): string {
  if (device.status !== "active") return t("manageKiosks.statusRevoked");
  if (device.paused_until !== null && Date.parse(device.paused_until) > now) {
    return t("manageKiosks.statusPaused");
  }
  return t("manageKiosks.statusActive");
}

function lastSeen(device: DeviceRow): string {
  if (device.last_seen_at === null) return t("manageKiosks.neverSeen");
  const at = new Date(device.last_seen_at);
  return t("manageKiosks.lastSeen", {
    date: formatBrusselsDate(at),
    time: formatBrusselsTime(at),
  });
}

/** Owners and admins: the shared tablets per site, their pairing codes and revocation. */
export default async function ManageKiosksPage() {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  await previewHold();
  const organizationId = context.membership.organizationId;
  const supabase = await createClient();
  const now = nowMs();

  const [sitesResult, devicesResult] = await Promise.all([
    supabase
      .from("sites")
      .select("id, name, active")
      .eq("organization_id", organizationId)
      .order("name"),
    // Never `*`: secret_hash is not granted, and must never be asked for.
    supabase
      .from("kiosk_devices")
      .select("id, site_id, name, status, last_seen_at, paused_until")
      .eq("organization_id", organizationId)
      .order("created_at"),
  ]);
  if (sitesResult.error) throw new Error(`sites_unavailable:${sitesResult.error.code}`);
  if (devicesResult.error) {
    throw new Error(`kiosk_devices_unavailable:${devicesResult.error.code}`);
  }

  const sites = sitesResult.data;
  const devices: DeviceRow[] = devicesResult.data;
  const activeSites = sites.filter((site) => site.active);
  const pairUrl = new URL("/kiosk/koppelen", env.CLOXA_SITE_URL).toString();
  const sitesWithDevices = sites
    .map((site) => ({
      site,
      devices: devices.filter((device) => device.site_id === site.id),
    }))
    .filter((group) => group.devices.length > 0);

  return (
    <PageTransition>
      <NavBar
        title={t("manageKiosks.heading")}
        back={{ href: "/manage/meer", label: t("manageMore.heading") }}
        trailing={
          activeSites.length > 0 ? (
            <NewKiosk
              sites={activeSites.map((site) => ({ id: site.id, name: site.name }))}
              pairUrl={pairUrl}
              action={createKioskAction}
            />
          ) : null
        }
      />
      <div className="flex flex-col gap-7 px-gutter pb-10 md:px-gutter-desktop">
        <p className="-mt-2 max-w-readable text-subhead text-ink-2">
          {t("manageKiosks.intro")}
        </p>
        {sitesWithDevices.length === 0 ? (
          <div className="rounded-card bg-card shadow-card">
            <EmptyState
              icon={Tablet}
              title={t("manageKiosks.emptyTitle")}
              body={t("manageKiosks.emptyBody")}
            />
          </div>
        ) : (
          <>
            <div className="hidden lg:block">
              <DataTable label={t("manageKiosks.heading")}>
                <DataHead>
                  <Th>{t("manageKiosks.nameColumn")}</Th>
                  <Th>{t("manageKiosks.siteLabel")}</Th>
                  <Th>{t("manageKiosks.statusColumn")}</Th>
                  <Th>{t("manageKiosks.lastSeenColumn")}</Th>
                  <Th>
                    <span className="sr-only">{t("manageKiosks.manage")}</span>
                  </Th>
                </DataHead>
                <tbody>
                  {sitesWithDevices.flatMap(({ site, devices: siteDevices }) =>
                    siteDevices.map((device) => (
                      <KioskTableRow
                        key={device.id}
                        siteName={site.name}
                        deviceId={device.id}
                        deviceName={device.name}
                        subtitle={lastSeen(device)}
                        statusLabel={deviceStatus(device, now)}
                        active={device.status === "active"}
                        pairUrl={pairUrl}
                        newCodeAction={newPairingCodeAction}
                        revokeAction={revokeKioskAction}
                      />
                    )),
                  )}
                </tbody>
              </DataTable>
            </div>
            <div className="flex flex-col gap-7 lg:hidden">
              {sitesWithDevices.map(({ site, devices: siteDevices }) => (
                <Section key={site.id} header={site.name}>
                  {siteDevices.map((device) => (
                    <KioskRow
                      key={device.id}
                      deviceId={device.id}
                      deviceName={device.name}
                      subtitle={lastSeen(device)}
                      statusLabel={deviceStatus(device, now)}
                      active={device.status === "active"}
                      pairUrl={pairUrl}
                      newCodeAction={newPairingCodeAction}
                      revokeAction={revokeKioskAction}
                    />
                  ))}
                </Section>
              ))}
            </div>
          </>
        )}
      </div>
    </PageTransition>
  );
}
