import { redirect } from "next/navigation";
import { Tablet } from "lucide-react";

import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { KioskRow, NewKiosk } from "@/components/manage/KioskSheets";
import { EmptyState } from "@/components/ui/EmptyState";
import { List, Section } from "@/components/ui/List";
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
      <List className="pb-10">
        <p className="-mt-2 px-4 text-subhead text-ink-2">{t("manageKiosks.intro")}</p>
        {sitesWithDevices.length === 0 ? (
          <EmptyState
            icon={Tablet}
            title={t("manageKiosks.emptyTitle")}
            body={t("manageKiosks.emptyBody")}
          />
        ) : (
          sitesWithDevices.map(({ site, devices: siteDevices }) => (
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
          ))
        )}
      </List>
    </PageTransition>
  );
}
