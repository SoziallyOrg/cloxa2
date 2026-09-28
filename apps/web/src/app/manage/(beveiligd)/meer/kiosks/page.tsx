import { redirect } from "next/navigation";

import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { KioskCreateForm } from "@/components/manage/KioskCreateForm";
import { KioskDeviceActions } from "@/components/manage/KioskDeviceActions";
import { ManageShell } from "@/components/manage/ManageShell";
import { Heading } from "@/components/ui/Heading";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { env } from "@/lib/env.server";
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

function deviceStatus(
  device: DeviceRow,
  now: number,
): { tone: StatusTone; label: string } {
  if (device.status !== "active") {
    return { tone: "off", label: t("manageKiosks.statusRevoked") };
  }
  if (device.paused_until !== null && Date.parse(device.paused_until) > now) {
    return { tone: "error", label: t("manageKiosks.statusPaused") };
  }
  return { tone: "working", label: t("manageKiosks.statusActive") };
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
  const organizationId = context.membership.organizationId;
  const supabase = await createClient();
  const now = nowMs();

  const [pending, sitesResult, devicesResult] = await Promise.all([
    supabase
      .from("correction_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
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

  return (
    <ManageShell
      active="more"
      pendingQuestionsCount={pending.count ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Heading level={1}>{t("manageKiosks.heading")}</Heading>
          <p className="text-lg text-ink/70">{t("manageKiosks.intro")}</p>
        </div>

        {activeSites.length > 0 ? (
          <section className="max-w-xl rounded-lg border border-border p-4">
            <KioskCreateForm
              sites={activeSites.map((site) => ({ id: site.id, name: site.name }))}
              pairUrl={pairUrl}
              action={createKioskAction}
            />
          </section>
        ) : null}

        <section className="flex flex-col gap-6">
          <Heading level={2}>{t("manageKiosks.listHeading")}</Heading>
          {sites.map((site) => {
            const siteDevices = devices.filter((device) => device.site_id === site.id);
            return (
              <div key={site.id} className="flex flex-col gap-3">
                <Heading level={3}>{site.name}</Heading>
                {siteDevices.length === 0 ? (
                  <p className="text-ink/70">{t("manageKiosks.noDevices")}</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {siteDevices.map((device) => {
                      const status = deviceStatus(device, now);
                      return (
                        <li
                          key={device.id}
                          className="flex flex-col gap-3 rounded-lg border border-border p-4"
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <p className="text-lg font-semibold">{device.name}</p>
                            <StatusBadge tone={status.tone} label={status.label} />
                          </div>
                          <p className="text-ink/70">{lastSeen(device)}</p>
                          {device.status === "active" ? (
                            <KioskDeviceActions
                              deviceId={device.id}
                              deviceName={device.name}
                              pairUrl={pairUrl}
                              newCodeAction={newPairingCodeAction}
                              revokeAction={revokeKioskAction}
                            />
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      </div>
    </ManageShell>
  );
}
