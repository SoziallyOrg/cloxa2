import { redirect } from "next/navigation";

import {
  brusselsLocalToInstant,
  formatBrusselsDate,
  formatBrusselsTime,
  t,
} from "@cloxa/i18n";

import { AuditPager } from "@/components/manage/AuditPager";
import { AuditVerifyButton } from "@/components/manage/AuditVerifyButton";
import { ManageShell } from "@/components/manage/ManageShell";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Heading } from "@/components/ui/Heading";
import { Stack } from "@/components/ui/Stack";
import { TextInput } from "@/components/ui/TextInput";
import { requireManager } from "@/lib/auth/context";
import { auditActorLabel } from "@/lib/audit/actor";
import {
  ACTION_DESCRIPTIONS,
  actionCategory,
  AUDIT_CATEGORIES,
  categoryLabelKey,
  describeAction,
  entityLabelKey,
} from "@/lib/audit/describe";
import { parseAuditFilters } from "@/lib/audit/filters";
import {
  auditKeysetFilter,
  decodeAuditCursor,
  paginateAuditKeyset,
} from "@/lib/audit/pagination";
import { createClient } from "@/lib/supabase/server";

import { verifyChainsAction } from "./actions";

const PAGE_SIZE = 50;

// TODO: exporting this log (CSV/JSON) is out of scope for now.

/** `YYYY-MM-DD` plus one calendar day, for an exclusive "to" boundary. */
function dayAfter(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** Only a plain string `device_id`, never the rest of `metadata`. */
function deviceIdFromMetadata(metadata: unknown): string | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const value = (metadata as Record<string, unknown>).device_id;
  return typeof value === "string" ? value : null;
}

/** Short, non-sensitive reference: the first 8 characters of the id. */
function shortId(id: string | null): string {
  return id ? id.slice(0, 8) : "—";
}

function auditPath(params: URLSearchParams): string {
  const query = params.toString();
  return query ? `/manage/meer/audit?${query}` : "/manage/meer/audit";
}

export default async function ManageAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await requireManager();
  if (context.membership.role !== "owner" && context.membership.role !== "admin") {
    redirect("/manage/meer");
  }
  const organizationId = context.membership.organizationId;
  const supabase = await createClient();

  const { count: pendingCount } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const rawParams = await searchParams;
  const filters = parseAuditFilters(rawParams);
  const cursor = decodeAuditCursor(filters.cursor);

  let query = supabase
    .from("audit_log")
    .select("id, actor_user_id, action, entity, entity_id, metadata, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE + 1);

  if (filters.from) {
    query = query.gte(
      "created_at",
      brusselsLocalToInstant(filters.from, "00:00").toISOString(),
    );
  }
  if (filters.to) {
    query = query.lt(
      "created_at",
      brusselsLocalToInstant(dayAfter(filters.to), "00:00").toISOString(),
    );
  }
  if (filters.category) {
    const actionsInCategory = Object.keys(ACTION_DESCRIPTIONS).filter(
      (action) => actionCategory(action) === filters.category,
    );
    query = query.in("action", actionsInCategory);
  }
  if (filters.actor) {
    const { data: matches, error: matchesError } = await supabase
      .from("employees")
      .select("user_id")
      .eq("organization_id", organizationId)
      .ilike("display_name", `%${filters.actor}%`);
    if (matchesError) throw new Error(`employees_unavailable:${matchesError.code}`);
    const actorIds = matches
      .map((row) => row.user_id)
      .filter((id): id is string => id !== null);
    // No match at all: force an empty result rather than dropping the filter.
    query = query.in(
      "actor_user_id",
      actorIds.length > 0 ? actorIds : ["00000000-0000-0000-0000-000000000000"],
    );
  }
  if (cursor) {
    query = query.or(auditKeysetFilter(cursor));
  }

  const { data: rows, error: rowsError } = await query;
  if (rowsError) throw new Error(`audit_log_unavailable:${rowsError.code}`);

  const page = paginateAuditKeyset(
    rows.map((row) => ({ ...row, createdAt: row.created_at })),
    PAGE_SIZE,
  );

  const actorIds = [
    ...new Set(
      page.items
        .map((row) => row.actor_user_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  const deviceIds = [
    ...new Set(
      page.items
        .filter((row) => row.actor_user_id === null)
        .map((row) => deviceIdFromMetadata(row.metadata))
        .filter((id): id is string => id !== null),
    ),
  ];

  const [employeesResult, devicesResult] = await Promise.all([
    actorIds.length === 0
      ? { data: [] as { user_id: string | null; display_name: string }[], error: null }
      : supabase
          .from("employees")
          .select("user_id, display_name")
          .eq("organization_id", organizationId)
          .in("user_id", actorIds),
    deviceIds.length === 0
      ? { data: [] as { id: string; name: string }[], error: null }
      : supabase
          .from("kiosk_devices")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", deviceIds),
  ]);
  if (employeesResult.error) {
    throw new Error(`employees_unavailable:${employeesResult.error.code}`);
  }
  if (devicesResult.error)
    throw new Error(`kiosk_devices_unavailable:${devicesResult.error.code}`);

  const displayNames = new Map(
    employeesResult.data.map((row) => [row.user_id, row.display_name]),
  );
  const deviceNames = new Map(devicesResult.data.map((row) => [row.id, row.name]));

  const baseParams = new URLSearchParams();
  if (filters.from) baseParams.set("from", filters.from);
  if (filters.to) baseParams.set("to", filters.to);
  if (filters.category) baseParams.set("category", filters.category);
  if (filters.actor) baseParams.set("actor", filters.actor);

  const nextParams = new URLSearchParams(baseParams);
  if (page.nextCursor) nextParams.set("cursor", page.nextCursor);
  const nextHref = page.nextCursor ? auditPath(nextParams) : null;

  return (
    <ManageShell
      active="more"
      pendingQuestionsCount={pendingCount ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <Stack gap="lg">
        <div className="flex flex-col gap-2">
          <Heading level={1}>{t("audit.heading")}</Heading>
          <p className="text-lg text-ink-2">{t("audit.intro")}</p>
        </div>

        <Card>
          <Stack gap="md">
            <Heading level={2}>{t("audit.verifyHeading")}</Heading>
            <AuditVerifyButton
              isOwner={context.membership.role === "owner"}
              action={verifyChainsAction}
            />
          </Stack>
        </Card>

        <Card>
          <form method="get" className="flex flex-wrap items-end gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-lg font-semibold">{t("audit.filterFrom")}</span>
              <TextInput type="date" name="from" defaultValue={filters.from ?? ""} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-lg font-semibold">{t("audit.filterTo")}</span>
              <TextInput type="date" name="to" defaultValue={filters.to ?? ""} />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-lg font-semibold">{t("audit.filterCategory")}</span>
              <select
                name="category"
                defaultValue={filters.category ?? ""}
                className="focus-ring min-h-touch-target rounded-md border-2 border-line bg-paper px-4 text-lg text-ink"
              >
                <option value="">{t("audit.filterCategoryAll")}</option>
                {AUDIT_CATEGORIES.map((category) => {
                  const key = categoryLabelKey(category);
                  return (
                    <option key={category} value={category}>
                      {key ? t(key) : category}
                    </option>
                  );
                })}
              </select>
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-lg font-semibold">{t("audit.filterActor")}</span>
              <TextInput
                type="text"
                name="actor"
                defaultValue={filters.actor ?? ""}
                placeholder={t("audit.filterActorHint")}
              />
            </label>
            <button
              type="submit"
              className="focus-ring inline-flex min-h-touch-target items-center rounded-md bg-ink px-6 text-lg font-semibold text-paper"
            >
              {t("audit.filterApply")}
            </button>
            <a
              href="/manage/meer/audit"
              className="focus-ring inline-flex min-h-touch-target items-center px-2 text-lg font-semibold text-ink underline"
            >
              {t("audit.filterClear")}
            </a>
          </form>
        </Card>

        {page.items.length === 0 ? (
          <EmptyState title={t("audit.empty")} body={t("audit.intro")} />
        ) : (
          <Stack gap="sm" as="ul">
            {page.items.map((row) => {
              const at = new Date(row.created_at);
              const deviceId =
                row.actor_user_id === null ? deviceIdFromMetadata(row.metadata) : null;
              const label = auditActorLabel({
                actorUserId: row.actor_user_id,
                displayName: row.actor_user_id
                  ? (displayNames.get(row.actor_user_id) ?? null)
                  : null,
                deviceId,
                deviceName: deviceId ? (deviceNames.get(deviceId) ?? null) : null,
              });
              const actorText =
                label.kind === "person"
                  ? (label.name ?? t("audit.actorUnknown"))
                  : label.kind === "kiosk"
                    ? t("audit.actorKiosk", {
                        name: label.deviceName ?? t("audit.actorUnknown"),
                      })
                    : t("audit.actorSystem");
              const entityKey = entityLabelKey(row.entity);

              return (
                <li key={row.id}>
                  <Card>
                    <Stack gap="sm">
                      <p className="text-ink-2">
                        {formatBrusselsDate(at)} {formatBrusselsTime(at)} · {actorText}
                      </p>
                      <p className="text-lg font-semibold">
                        {t(describeAction(row.action))}
                      </p>
                      <p className="text-ink-2">
                        {t("audit.entityLabel", {
                          entity: `${entityKey ? t(entityKey) : row.entity} ${shortId(row.entity_id)}`,
                        })}
                      </p>
                    </Stack>
                  </Card>
                </li>
              );
            })}
          </Stack>
        )}

        <AuditPager hasPrevious={cursor !== null} nextHref={nextHref} />
      </Stack>
    </ManageShell>
  );
}
