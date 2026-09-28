import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { ExportForm } from "@/components/exports/ExportForm";
import { ManageShell } from "@/components/manage/ManageShell";
import { buttonClassName } from "@/components/ui/Button";
import { Heading } from "@/components/ui/Heading";
import { requireManager } from "@/lib/auth/context";
import { nowMs } from "@/lib/clock/now";
import { periodQuickPicks } from "@/lib/exports/brussels";
import { loadExportableSites } from "@/lib/exports/load";
import { DEV_UNSIGNED_KEY_ID } from "@/lib/exports/signing";
import { createClient } from "@/lib/supabase/server";

import { createExportAction } from "./actions";

const LIST_LIMIT = 50;

function dateLabel(day: string): string {
  // Noon UTC is the same calendar day in Brussels all year round.
  return formatBrusselsDate(new Date(`${day}T12:00:00Z`));
}

/** PostgREST returns bytea as `\x<hex>`. */
function shortHash(bytea: string): string {
  return bytea.replace(/^\\x/, "").slice(0, 12);
}

export default async function ManageExportsPage() {
  const context = await requireManager();
  const supabase = await createClient();

  const { count: pendingCount } = await supabase
    .from("correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const sites = await loadExportableSites(supabase, context.membership);
  const siteNames = new Map(sites.map((site) => [site.id, site.name]));

  // Never select content here: it is only served through the audited download.
  const { data: exportRows, error: exportsError } = await supabase
    .from("exports")
    .select(
      "id, period_from, period_to, site_ids, row_count, created_by, created_at, content_sha256, signing_key_id",
    )
    .eq("organization_id", context.membership.organizationId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (exportsError) throw new Error(`exports_unavailable:${exportsError.code}`);

  const creatorIds = [...new Set(exportRows.map((row) => row.created_by))];
  const { data: creatorRows, error: creatorsError } =
    creatorIds.length === 0
      ? { data: [], error: null }
      : await supabase
          .from("employees")
          .select("user_id, display_name")
          .eq("organization_id", context.membership.organizationId)
          .in("user_id", creatorIds);
  if (creatorsError) throw new Error(`employees_unavailable:${creatorsError.code}`);
  const creatorNames = new Map(
    creatorRows.map((row) => [row.user_id, row.display_name] as const),
  );

  function creatorLabel(userId: string): string {
    if (userId === context.claims.userId) return t("exports.createdByYou");
    return creatorNames.get(userId) ?? t("exports.createdByOther");
  }

  function sitesLabel(siteIds: readonly string[] | null): string {
    if (siteIds === null) return t("exports.allSites");
    return siteIds.map((id) => siteNames.get(id) ?? "—").join(", ");
  }

  return (
    <ManageShell
      active="more"
      pendingQuestionsCount={pendingCount ?? 0}
      showSwitchToEmployee={context.employeeId !== null}
    >
      <div className="flex flex-col gap-8">
        <div className="flex flex-col gap-2">
          <Heading level={1}>{t("exports.heading")}</Heading>
          <p className="text-lg text-ink-2">{t("exports.intro")}</p>
          <p className="text-lg text-ink-2">{t("exports.indicative")}</p>
          <p className="text-lg text-ink-2">{t("exports.csvUnsigned")}</p>
        </div>

        <section className="max-w-xl rounded-lg border border-line p-4">
          <ExportForm
            sites={sites}
            quickPicks={periodQuickPicks(nowMs())}
            action={createExportAction}
          />
        </section>

        <section className="flex flex-col gap-4">
          <Heading level={2}>{t("exports.listHeading")}</Heading>
          {exportRows.length === 0 ? (
            <p className="text-ink-2">{t("exports.empty")}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {exportRows.map((row) => {
                const createdAt = new Date(row.created_at);
                return (
                  <li
                    key={row.id}
                    className="flex flex-col gap-3 rounded-lg border border-line p-4"
                  >
                    <div className="flex flex-col gap-1">
                      <p className="text-lg font-semibold">
                        {t("exports.period", {
                          from: dateLabel(row.period_from),
                          to: dateLabel(row.period_to),
                        })}
                      </p>
                      <p className="text-ink-2">
                        {sitesLabel(row.site_ids)} ·{" "}
                        {t("exports.rows", { count: row.row_count })}
                      </p>
                      <p className="text-ink-2">
                        {t("exports.createdBy", {
                          name: creatorLabel(row.created_by),
                          date: `${formatBrusselsDate(createdAt)} ${formatBrusselsTime(createdAt)}`,
                        })}
                      </p>
                      <p className="font-mono text-ink-2">
                        {t("exports.hash", { hash: shortHash(row.content_sha256) })}
                      </p>
                      {row.signing_key_id === DEV_UNSIGNED_KEY_ID ? (
                        <p className="text-ink-2">{t("exports.devUnsigned")}</p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      {/* Plain links, never <Link>: a prefetch would count as a download. */}
                      <a
                        href={`/manage/meer/exports/${row.id}/csv`}
                        className={buttonClassName("secondary", "md")}
                      >
                        {t("exports.downloadCsv")}
                      </a>
                      <a
                        href={`/manage/meer/exports/${row.id}/json`}
                        className={buttonClassName("plain", "md")}
                      >
                        {t("exports.downloadJson")}
                      </a>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </ManageShell>
  );
}
