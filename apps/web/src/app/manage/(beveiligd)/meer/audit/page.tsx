import { redirect } from "next/navigation";

import { ScrollText, X } from "lucide-react";

import { brusselsDayKey } from "@cloxa/domain";
import {
  brusselsLocalToInstant,
  formatBrusselsLongDay,
  formatBrusselsShortDate,
  formatBrusselsTime,
  t,
} from "@cloxa/i18n";

import { AuditFilterSheet } from "@/components/manage/AuditFilterSheet";
import { AuditPager } from "@/components/manage/AuditPager";
import { AuditVerifyButton } from "@/components/manage/AuditVerifyButton";
import { DataHead, DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { Row, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { auditActorLabel } from "@/lib/audit/actor";
import {
  ACTION_DESCRIPTIONS,
  actionCategory,
  AUDIT_CATEGORIES,
  categoryLabelKey,
  auditEmployeeId,
  describeAuditEntry,
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
  await previewHold();
  const organizationId = context.membership.organizationId;
  const supabase = await createClient();

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

  // The employee of a manager-made correction, for its sentence.
  const subjectIds = [
    ...new Set(
      page.items
        .map((row) => auditEmployeeId(row.action, row.metadata))
        .filter((id): id is string => id !== null),
    ),
  ];

  const [employeesResult, devicesResult, subjectsResult] = await Promise.all([
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
    subjectIds.length === 0
      ? { data: [] as { id: string; display_name: string }[], error: null }
      : supabase
          .from("employees")
          .select("id, display_name")
          .eq("organization_id", organizationId)
          .in("id", subjectIds),
  ]);
  if (subjectsResult.error) {
    throw new Error(`employees_unavailable:${subjectsResult.error.code}`);
  }
  const subjectNames = new Map(
    subjectsResult.data.map((row) => [row.id, row.display_name]),
  );
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

  const filtered = baseParams.size > 0;

  // One soft group per Brussels day, newest first.
  type AuditRow = (typeof page.items)[number];
  const days: { key: string; label: string; rows: AuditRow[] }[] = [];
  for (const row of page.items) {
    const at = Date.parse(row.created_at);
    const key = brusselsDayKey(at);
    const last = days.at(-1);
    if (last?.key === key) last.rows.push(row);
    else days.push({ key, label: formatBrusselsLongDay(new Date(at)), rows: [row] });
  }

  function actorText(row: (typeof page.items)[number]): string {
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
    return label.kind === "person"
      ? (label.name ?? t("audit.actorUnknown"))
      : label.kind === "kiosk"
        ? t("audit.actorKiosk", { name: label.deviceName ?? t("audit.actorUnknown") })
        : t("audit.actorSystem");
  }

  function actionText(row: (typeof page.items)[number]): string {
    const subjectId = auditEmployeeId(row.action, row.metadata);
    return t(describeAuditEntry(row.action, row.metadata), {
      actor: actorText(row),
      employee:
        (subjectId ? subjectNames.get(subjectId) : null) ??
        t("audit.action.employeeUnknown"),
    });
  }

  return (
    <PageTransition>
      <NavBar
        title={t("audit.heading")}
        back={{ href: "/manage/meer", label: t("manageMore.heading") }}
        trailing={
          <AuditFilterSheet
            from={filters.from ?? ""}
            to={filters.to ?? ""}
            category={filters.category ?? ""}
            actor={filters.actor ?? ""}
            categories={AUDIT_CATEGORIES.map((category) => {
              const key = categoryLabelKey(category);
              return [category, key ? t(key) : category] as const;
            })}
          />
        }
      />
      <div className="flex flex-col gap-7 px-gutter pb-10 md:px-gutter-desktop">
        <p className="-mt-2 max-w-readable text-subhead text-ink-2">
          {t("audit.intro")}
        </p>

        <AuditVerifyButton
          isOwner={context.membership.role === "owner"}
          action={verifyChainsAction}
        />

        {filtered ? (
          <Section footer={t("audit.filterActiveNote")}>
            <Row
              href="/manage/meer/audit"
              icon={X}
              title={t("audit.filterClear")}
              chevron={false}
            />
          </Section>
        ) : null}

        {days.length === 0 ? (
          <div className="rounded-card bg-card shadow-card">
            <EmptyState
              icon={ScrollText}
              title={t("audit.empty")}
              body={t("audit.intro")}
            />
          </div>
        ) : (
          <>
            <div className="hidden lg:block">
              <DataTable label={t("audit.heading")}>
                <DataHead>
                  <Th>{t("audit.timeColumn")}</Th>
                  <Th>{t("audit.actorColumn")}</Th>
                  <Th>{t("audit.actionColumn")}</Th>
                  <Th>{t("audit.entityColumn")}</Th>
                </DataHead>
                <tbody>
                  {page.items.map((row) => {
                    const entityKey = entityLabelKey(row.entity);
                    const at = new Date(row.created_at);
                    return (
                      <Tr key={row.id}>
                        <Td className="whitespace-nowrap tabular-nums">
                          {formatBrusselsShortDate(at)} {formatBrusselsTime(at)}
                        </Td>
                        <Td>{actorText(row)}</Td>
                        <Td className="font-semibold">{actionText(row)}</Td>
                        <Td className="text-ink-2">
                          {entityKey ? t(entityKey) : row.entity}{" "}
                          {shortId(row.entity_id)}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </DataTable>
            </div>
            <div className="flex flex-col gap-7 lg:hidden">
              {days.map((day) => (
                <Section key={day.key} header={day.label}>
                  {day.rows.map((row) => {
                    const entityKey = entityLabelKey(row.entity);
                    return (
                      <Row
                        key={row.id}
                        title={actionText(row)}
                        subtitle={[
                          t("audit.rowDetail", {
                            time: formatBrusselsTime(new Date(row.created_at)),
                            actor: actorText(row),
                          }),
                          t("audit.entityLabel", {
                            entity: `${entityKey ? t(entityKey) : row.entity} ${shortId(row.entity_id)}`,
                          }),
                        ].join(" · ")}
                      />
                    );
                  })}
                </Section>
              ))}
            </div>
          </>
        )}

        <div className="max-w-readable">
          <AuditPager hasPrevious={cursor !== null} nextHref={nextHref} />
        </div>
      </div>
    </PageTransition>
  );
}
