"use client";

import { useDeferredValue, useState } from "react";
import { Search, Users } from "lucide-react";
import { useFormStatus } from "react-dom";

import { t } from "@cloxa/i18n";

import { ActivityIndicator } from "../ui/ActivityIndicator";
import { cx } from "../ui/cx";
import { EmptyState } from "../ui/EmptyState";
import { Row, Section } from "../ui/List";

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
}

export interface TeamListProps {
  rows: readonly TeamListRow[];
  /** Shown when the segment has nobody at all (not when a search finds nobody). */
  empty: { title: string; body: string };
  revokeAction?: (formData: FormData) => Promise<void>;
}

function matches(row: TeamListRow, query: string): boolean {
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

/**
 * The team as one soft group, with a search field on top that filters as
 * you type (by name, code, site or statute), so a team of 100+ stays usable.
 */
export function TeamList({ rows, empty, revokeAction }: TeamListProps) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const visible = rows.filter((row) => matches(row, deferred));

  if (rows.length === 0) {
    return <EmptyState icon={Users} title={empty.title} body={empty.body} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="relative block">
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
          className={cx(
            "min-h-touch-target w-full rounded-control border border-field bg-card pr-4 pl-11 text-body text-ink placeholder:text-ink-2",
            "outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest",
          )}
        />
      </label>

      {visible.length === 0 ? (
        <div aria-live="polite">
          <EmptyState
            icon={Search}
            title={t("manageTeam.noResults", { query: deferred.trim() })}
            body={t("manageTeam.noResultsBody")}
          />
        </div>
      ) : (
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
      )}
    </div>
  );
}
