import { formatBrusselsDate, formatBrusselsTime, t } from "@cloxa/i18n";
import { interimAgency } from "@cloxa/modules";

import { FileDown } from "lucide-react";

import { ExportForm } from "@/components/exports/ExportForm";
import { EmptyState } from "@/components/ui/EmptyState";
import { DataHead, DataTable, Td, Th, Tr } from "@/components/ui/DataTable";
import { ListItem, Section } from "@/components/ui/List";
import { NavBar } from "@/components/ui/NavBar";
import { PageTransition } from "@/components/ui/PageTransition";
import { requireManager } from "@/lib/auth/context";
import { previewHold } from "@/lib/preview";
import { nowMs } from "@/lib/clock/now";
import { periodQuickPicks } from "@/lib/exports/brussels";
import { loadExportableSites } from "@/lib/exports/load";
import { loadEnabledModules } from "@/lib/modules/load";
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

/** Distinct agency names, sorted, from the interim data the caller can read. */
async function loadAgencies(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("employee_module_data")
    .select("data")
    .eq("module", "interim");
  if (error) throw new Error(`employee_module_data_unavailable:${error.code}`);
  const names = new Set<string>();
  for (const row of data) {
    const name = interimAgency(row.data);
    if (name !== null) names.add(name);
  }
  return [...names].sort((a, b) => a.localeCompare(b, "nl-BE"));
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
      "id, period_from, period_to, site_ids, row_count, created_by, created_at, content_sha256, signing_key_id, interim_agency",
    )
    .eq("organization_id", context.membership.organizationId)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (exportsError) throw new Error(`exports_unavailable:${exportsError.code}`);

  // With the interim module on: the agencies of the workers this manager sees.
  const interimOn = (
    await loadEnabledModules(supabase, context.membership.organizationId)
  ).some(({ module }) => module.id === "interim");
  const agencies = interimOn ? await loadAgencies(supabase) : [];

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

  // Plain links, never <Link>: a prefetch would count as a download. On
  // `track`, not `paper`: paper is black in dark mode, a black button on grey.
  const DOWNLOAD =
    "focus-ring inline-flex min-h-touch-target min-w-16 pressable items-center justify-center rounded-control border-[1.5px] border-line bg-card px-4 text-subhead font-bold text-ink";

  return (
    <PageTransition>
      <NavBar title={t("exports.heading")} subtitle={t("exports.intro")} />
      <div className="flex flex-col gap-7 px-gutter pb-10 md:px-gutter-desktop">
        <ExportForm
          sites={sites}
          agencies={agencies}
          quickPicks={periodQuickPicks(nowMs())}
          action={createExportAction}
        />

        {exportRows.length === 0 ? (
          <div className="rounded-card bg-card shadow-card">
            <EmptyState
              icon={FileDown}
              title={t("exports.empty")}
              body={t("exports.emptyBody")}
            />
          </div>
        ) : (
          <>
            <div className="lg:hidden">
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
                            row.interim_agency
                              ? t("exports.agencyValue", { agency: row.interim_agency })
                              : null,
                            t("exports.rows", { count: row.row_count }),
                            t("exports.createdBy", {
                              name: creatorLabel(row.created_by),
                              date: `${formatBrusselsDate(createdAt)} ${formatBrusselsTime(createdAt)}`,
                            }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
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
            </div>

            <section className="hidden flex-col gap-2 lg:flex">
              <h2 className="px-1 text-footnote font-bold text-ink-2">
                {t("exports.listHeading")}
              </h2>
              <DataTable label={t("exports.listHeading")}>
                <DataHead>
                  <Th>{t("exports.periodColumn")}</Th>
                  <Th>{t("exports.sitesColumn")}</Th>
                  <Th align="right">{t("exports.rowsColumn")}</Th>
                  <Th>{t("exports.createdColumn")}</Th>
                  <Th>{t("exports.hashColumn")}</Th>
                  <Th>{t("exports.downloadColumn")}</Th>
                </DataHead>
                <tbody>
                  {exportRows.map((row) => {
                    const createdAt = new Date(row.created_at);
                    const period = t("exports.period", {
                      from: dateLabel(row.period_from),
                      to: dateLabel(row.period_to),
                    });
                    return (
                      <Tr key={row.id}>
                        <Td className="font-semibold">{period}</Td>
                        <Td>
                          {sitesLabel(row.site_ids)}
                          {row.interim_agency ? (
                            <span className="block text-footnote text-ink-2">
                              {t("exports.agencyValue", { agency: row.interim_agency })}
                            </span>
                          ) : null}
                        </Td>
                        <Td align="right" className="tabular-nums">
                          {row.row_count}
                        </Td>
                        <Td>
                          {creatorLabel(row.created_by)}
                          <span className="block text-footnote text-ink-2 tabular-nums">
                            {formatBrusselsDate(createdAt)}{" "}
                            {formatBrusselsTime(createdAt)}
                          </span>
                        </Td>
                        <Td className="font-mono text-footnote text-ink-2">
                          {shortHash(row.content_sha256)}
                          {row.signing_key_id === DEV_UNSIGNED_KEY_ID ? (
                            <span className="block font-sans">
                              {t("exports.devUnsigned")}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <span className="flex gap-2">
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
                          </span>
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </DataTable>
              <p className="px-1 text-subhead text-ink-2">{t("exports.csvUnsigned")}</p>
              <p className="px-1 text-subhead text-ink-2">{t("exports.indicative")}</p>
            </section>
          </>
        )}
      </div>
    </PageTransition>
  );
}
