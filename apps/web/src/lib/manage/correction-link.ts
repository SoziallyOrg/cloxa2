/**
 * The link into a manager's correction ("Oplossen", "Aanpassen"): building it
 * and reading it back. Pure. Everything in the query string is only a
 * suggestion for the form; the database decides what is allowed.
 */
import { z } from "zod";

/** Where a saved correction returns to: a fixed choice, never a free URL. */
export const CORRECTION_RETURNS = ["vandaag", "medewerker"] as const;
export type CorrectionReturn = (typeof CORRECTION_RETURNS)[number];

export function correctionReturn(value: unknown): CorrectionReturn {
  return value === "vandaag" ? "vandaag" : "medewerker";
}

const dateSchema = z.iso.date();

export interface CorrectionPrefill {
  /** `YYYY-MM-DD`: the day to fix; `null` when none (or an invalid one) came along. */
  readonly date: string | null;
  /** `?soort=einde`: a forgotten clock-out on `date`. Needs a valid `date`. */
  readonly forgotClockOut: boolean;
  readonly returnTo: CorrectionReturn;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/** Unknown or invalid values are ignored, never an error. */
export function parseCorrectionPrefill(
  params: Readonly<Record<string, string | string[] | undefined>>,
  /** Days outside `earliest`..`latest` (`YYYY-MM-DD`) are ignored too. */
  bounds?: { earliest: string; latest: string },
): CorrectionPrefill {
  const parsed = dateSchema.safeParse(first(params.datum));
  const date =
    parsed.success &&
    (bounds === undefined ||
      (parsed.data >= bounds.earliest && parsed.data <= bounds.latest))
      ? parsed.data
      : null;
  return {
    date,
    forgotClockOut: date !== null && first(params.soort) === "einde",
    returnTo: correctionReturn(first(params.terug)),
  };
}

export interface CorrectionHrefOptions {
  readonly date?: string;
  readonly forgotClockOut?: boolean;
  readonly returnTo?: CorrectionReturn;
}

export function correctionHref(
  employeeId: string,
  { date, forgotClockOut = false, returnTo }: CorrectionHrefOptions = {},
): string {
  const query = new URLSearchParams();
  if (forgotClockOut && date) query.set("soort", "einde");
  if (date) query.set("datum", date);
  if (returnTo) query.set("terug", returnTo);
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/manage/medewerker/${employeeId}/correctie${suffix}`;
}

/** Where to go after saving, and the value `?gecorrigeerd=` carries (the employee's id). */
export function correctionDoneHref(
  returnTo: CorrectionReturn,
  employeeId: string,
): string {
  const query = `gecorrigeerd=${encodeURIComponent(employeeId)}`;
  return returnTo === "vandaag"
    ? `/manage?${query}`
    : `/manage/medewerker/${employeeId}?${query}`;
}

/** `?gecorrigeerd=` as an employee id, or `null`. */
export function correctedEmployeeId(value: unknown): string | null {
  const parsed = z.uuid().safeParse(Array.isArray(value) ? value[0] : value);
  return parsed.success ? parsed.data : null;
}

interface SiteEvent {
  readonly siteId: string;
  readonly occurredAt: number;
}

/**
 * The site to propose: where the last registration of the day was made (or,
 * without a day, the latest one), if the employee still works there; else the
 * first assigned site.
 */
export function defaultSiteId(
  events: readonly SiteEvent[],
  sites: readonly { id: string }[],
  dayOf: (at: number) => string,
  date: string | null,
): string | null {
  const candidates =
    date === null ? events : events.filter((e) => dayOf(e.occurredAt) === date);
  const latest = candidates.reduce<SiteEvent | null>(
    (best, event) =>
      best === null || event.occurredAt > best.occurredAt ? event : best,
    null,
  );
  return sites.find((site) => site.id === latest?.siteId)?.id ?? sites[0]?.id ?? null;
}
