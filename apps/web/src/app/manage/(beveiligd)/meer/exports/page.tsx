import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";

import { FileDown } from "lucide-react";

import { ExportForm } from "@/components/exports/ExportForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { List, ListItem, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
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
  await previewHold();
  const supabase = await createClient();

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

  // Plain links, never <Link>: a prefetch would count as a download.
  const DOWNLOAD =
    "focus-ring inline-flex min-h-touch-target min-w-16 pressable items-center justify-center rounded-full bg-paper px-4 text-subhead font-semibold text-ink";

  return (
    <PageTransition>
      <NavBar title={t("exports.heading")} subtitle={t("exports.intro")} />
      <List className="pb-10">
        <ExportForm
          sites={sites}
          quickPicks={periodQuickPicks(nowMs())}
          action={createExportAction}
        />

        {exportRows.length === 0 ? (
          <EmptyState
            icon={FileDown}
            title={t("exports.empty")}
            body={t("exports.emptyBody")}
          />
        ) : (
          <Section
            header={t("exports.listHeading")}
            footer={
              <span className="flex flex-col gap-1">
                <span>{t("exports.csvUnsigned")}</span>
                <span>{t("exports.indicative")}</span>
              </span>
            }
          >
            {exportRows.map((row) => {
              const createdAt = new Date(row.created_at);
              const period = t("exports.period", {
                from: dateLabel(row.period_from),
                to: dateLabel(row.period_to),
              });
              return (
                <ListItem key={row.id} className="gap-3 py-3">
                  <div className="flex min-w-0 flex-col">
                    <p className="text-body break-words">{period}</p>
                    <p className="text-subhead text-ink-2">
                      {[
                        sitesLabel(row.site_ids),
                        t("exports.rows", { count: row.row_count }),
                        t("exports.createdBy", {
                          name: creatorLabel(row.created_by),
                          date: `${formatBrusselsDate(createdAt)} ${formatBrusselsTime(createdAt)}`,
                        }),
                      ].join(" · ")}
                    </p>
                    <p className="font-mono text-footnote text-ink-2">
                      {t("exports.hash", { hash: shortHash(row.content_sha256) })}
                    </p>
                    {row.signing_key_id === DEV_UNSIGNED_KEY_ID ? (
                      <p className="text-footnote text-ink-2">
                        {t("exports.devUnsigned")}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/manage/meer/exports/${row.id}/csv`}
                      aria-label={`${t("exports.downloadCsv")}: ${period}`}
                      className={DOWNLOAD}
                    >
                      {t("exports.csvShort")}
                    </a>
                    <a
                      href={`/manage/meer/exports/${row.id}/json`}
                      aria-label={`${t("exports.downloadJson")}: ${period}`}
                      className={DOWNLOAD}
                    >
                      {t("exports.jsonShort")}
                    </a>
                  </div>
                </ListItem>
              );
            })}
          </Section>
        )}
      </List>
    </PageTransition>
  );
}
