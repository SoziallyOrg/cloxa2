"use client";

import { useDeferredValue, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import { PanelRight, Search, Users } from "lucide-react";
import { useFormStatus } from "react-dom";

import { t } from "@cloxa/i18n";

import { ActivityIndicator } from "../ui/ActivityIndicator";
import { buttonClassName } from "../ui/Button";
import { cx } from "../ui/cx";
import { Badge, DataHead, DataTable, Td, Th, Tr } from "../ui/DataTable";
import { EmptyState } from "../ui/EmptyState";
import { Row, Section } from "../ui/List";
import { SidePanel } from "../ui/SidePanel";

export interface TeamListRow {
  id: string;
  name: string;
  /** Searched too, never shown in the title. */
  code: string | null;
  /** "Hoofdvestiging · Bediende". */
  subtitle: string;
  /** "Uitgenodigd", "Geschorst", a leaving date; `null` when simply active. */
  status: string | null;
  /** Detail page; invitations have none. */
  href: string | null;
  /** An open invitation that can still be revoked. */
  invitationId?: string;
  /** Owners and admins only; `null` when the viewer may not read roles. */
  role: string | null;
  /** The statute label ("Bediende", "Student"): the module badge. */
  statute: string | null;
  sites: readonly string[];
  /** "vandaag 08:02"; `null` when nothing was clocked in the last 14 days. */
  lastClock: string | null;
}

export interface TeamListProps {
  rows: readonly TeamListRow[];
  /** Shown when the segment has nobody at all (not when a search finds nobody). */
  empty: { title: string; body: string };
  /** Show the Rol column: only when the viewer may read roles. */
  showRoles: boolean;
  /** Every active site name, for the location filter (shown from two sites). */
  siteNames: readonly string[];
  revokeAction?: (formData: FormData) => Promise<void>;
}

function matches(row: TeamListRow, query: string, site: string): boolean {
  if (site !== "" && !row.sites.includes(site)) return false;
  const needle = query.trim().toLocaleLowerCase("nl-BE");
  if (needle === "") return true;
  return [row.name, row.code ?? "", row.subtitle].some((field) =>
    field.toLocaleLowerCase("nl-BE").includes(needle),
  );
}

function RevokeButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className="focus-ring -mr-2 inline-flex min-h-touch-target shrink-0 pressable items-center gap-2 rounded-control px-2 text-body text-danger disabled:opacity-60"
    >
      {pending ? <ActivityIndicator size="sm" /> : null}
      {label}
    </button>
  );
}

const FIELD =
  "min-h-touch-target rounded-control border border-field bg-card text-body text-ink outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest";

function statusBadge(row: TeamListRow): ReactNode {
  return row.status ? (
    <Badge tone="break">{row.status}</Badge>
  ) : (
    <Badge tone="forest">{t("manageTeam.statusActive")}</Badge>
  );
}

/**
 * The team with a search field and a location filter on top. From 1024px a
 * real table (name, role, statute, site, status, last clock); choosing a row
 * shows a summary in the side panel with a link to the full page. Below that,
 * the soft list of rows. Both are in the markup and CSS picks one.
 */
export function TeamList({
  rows,
  empty,
  showRoles,
  siteNames,
  revokeAction,
}: TeamListProps) {
  const [query, setQuery] = useState("");
  const [site, setSite] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const deferred = useDeferredValue(query);
  const visible = rows.filter((row) => matches(row, deferred, site));
  const selected = rows.find((row) => row.id === selectedId) ?? null;

  if (rows.length === 0) {
    return (
      <div className="rounded-card bg-card shadow-card">
        <EmptyState icon={Users} title={empty.title} body={empty.body} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-3">
        <label className="relative block min-w-56 flex-1 md:max-w-md">
          <span className="sr-only">{t("manageTeam.searchLabel")}</span>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-2"
            strokeWidth={1.75}
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("manageTeam.searchPlaceholder")}
            autoComplete="off"
            enterKeyHint="search"
            className={cx(FIELD, "w-full pr-4 pl-11 placeholder:text-ink-2")}
          />
        </label>
        {siteNames.length > 1 ? (
          <label className="block">
            <span className="sr-only">{t("manage.siteFilterLabel")}</span>
            <select
              value={site}
              onChange={(event) => setSite(event.target.value)}
              className={cx(FIELD, "px-3")}
            >
              <option value="">{t("manage.siteFilterAll")}</option>
              {siteNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {visible.length === 0 ? (
        <div aria-live="polite" className="rounded-card bg-card shadow-card">
          <EmptyState
            icon={Search}
            title={t("manageTeam.noResults", { query: deferred.trim() })}
            body={t("manageTeam.noResultsBody")}
          />
        </div>
      ) : (
        <>
          <div className="lg:hidden">
            <Section>
              {visible.map((row) =>
                row.href ? (
                  <Row
                    key={row.id}
                    href={row.href}
                    title={row.name}
                    subtitle={row.subtitle}
                    value={row.status ?? undefined}
                  />
                ) : (
                  <Row
                    key={row.id}
                    title={row.name}
                    subtitle={row.subtitle}
                    accessory={
                      row.invitationId && revokeAction ? (
                        <form action={revokeAction}>
                          <input type="hidden" name="id" value={row.invitationId} />
                          <RevokeButton label={t("manageTeam.revoke")} />
                        </form>
                      ) : null
                    }
                  />
                ),
              )}
            </Section>
          </div>

          <div className="@container hidden lg:block">
            <DataTable label={t("manageTeam.heading")}>
              <DataHead>
                <Th>{t("manageTeam.nameLabel")}</Th>
                {showRoles ? (
                  <Th className="hidden @3xl:table-cell">
                    {t("manageTeam.roleLabel")}
                  </Th>
                ) : null}
                <Th className="hidden @xl:table-cell">
                  {t("manageTeam.statuteLabel")}
                </Th>
                <Th className="hidden @4xl:table-cell">{t("manageTeam.siteColumn")}</Th>
                <Th>{t("manageTeam.statusColumn")}</Th>
                <Th className="hidden @3xl:table-cell">
                  {t("manageTeam.lastClockColumn")}
                </Th>
                <Th>
                  <span className="sr-only">{t("manageTeam.summaryColumn")}</span>
                </Th>
              </DataHead>
              <tbody>
                {visible.map((row) => {
                  const isSelected = row.id === selected?.id;
                  return (
                    <Tr
                      key={row.id}
                      selected={isSelected}
                      onSelect={() => setSelectedId(isSelected ? null : row.id)}
                    >
                      <Td>
                        {row.href ? (
                          <Link
                            href={row.href as Route}
                            onClick={(event) => event.stopPropagation()}
                            className="focus-ring inline-flex min-h-touch-target items-center rounded-control font-bold underline-offset-4 hover:underline"
                          >
                            {row.name}
                          </Link>
                        ) : (
                          <span className="font-bold">{row.name}</span>
                        )}
                      </Td>
                      {showRoles ? (
                        <Td className="hidden @3xl:table-cell">
                          {row.role ?? t("common.none")}
                        </Td>
                      ) : null}
                      <Td className="hidden @xl:table-cell">
                        {row.statute ? <Badge>{row.statute}</Badge> : t("common.none")}
                      </Td>
                      <Td className="hidden @4xl:table-cell">
                        {row.sites.length > 0 ? row.sites.join(", ") : t("common.none")}
                      </Td>
                      <Td>{statusBadge(row)}</Td>
                      <Td className="hidden text-ink-2 tabular-nums @3xl:table-cell">
                        {row.lastClock ?? t("common.none")}
                      </Td>
                      <Td align="right">
                        <button
                          type="button"
                          aria-pressed={isSelected}
                          aria-label={t("manageTeam.showSummary", { name: row.name })}
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedId(isSelected ? null : row.id);
                          }}
                          className={cx(
                            "focus-ring inline-flex size-12 items-center justify-center rounded-control",
                            isSelected ? "bg-forest text-white" : "text-ink-2",
                          )}
                        >
                          <PanelRight
                            aria-hidden="true"
                            className="size-5"
                            strokeWidth={1.75}
                          />
                        </button>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        </>
      )}

      <SidePanel title={selected?.name ?? t("manageToday.panelTitle")}>
        {selected ? (
          <div className="flex flex-col gap-5">
            <h2 className="text-title-2 break-words">{selected.name}</h2>
            <dl className="flex flex-col gap-3 text-callout">
              <Fact label={t("manageTeam.codeColumn")} value={selected.code} />
              {showRoles ? (
                <Fact label={t("manageTeam.roleLabel")} value={selected.role} />
              ) : null}
              <Fact label={t("manageTeam.statuteLabel")} value={selected.statute} />
              <Fact
                label={t("manageTeam.siteColumn")}
                value={selected.sites.length > 0 ? selected.sites.join(", ") : null}
              />
              <Fact
                label={t("manageTeam.statusColumn")}
                value={selected.status ?? t("manageTeam.statusActive")}
              />
              <Fact
                label={t("manageTeam.lastClockColumn")}
                value={selected.lastClock}
              />
            </dl>
            {selected.href ? (
              <Link
                href={selected.href as Route}
                className={buttonClassName("primary", "md", true)}
              >
                {t("manageTeam.openDetail")}
              </Link>
            ) : selected.invitationId && revokeAction ? (
              <form action={revokeAction}>
                <input type="hidden" name="id" value={selected.invitationId} />
                <RevokeButton label={t("manageTeam.revoke")} />
              </form>
            ) : null}
          </div>
        ) : (
          <p className="text-callout text-ink-2">{t("manageTeam.detailHint")}</p>
        )}
      </SidePanel>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line pb-2.5 last:border-b-0">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="text-right font-semibold break-words">
        {value ?? t("common.none")}
      </dd>
    </div>
  );
}
