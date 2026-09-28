/**
 * The `cloxa.export.v1` snapshot: one row per employee per Brussels day.
 * Durations are integer milliseconds, instants are UTC ISO strings with a
 * Brussels local twin. Field names are snake_case and stable: changing them
 * means a new format version.
 */
import { z } from "zod";

export const EXPORT_FORMAT_VERSION = "cloxa.export.v1";
export const EXPORT_TIMEZONE = "Europe/Brussels";

const int = z.int();
const day = z.iso.date();
const instant = z.iso.datetime();
const localInstant = z.iso.datetime({ offset: true });

export const exportShiftSchema = z.strictObject({
  site_id: z.uuid(),
  site_name: z.string(),
  start_utc: instant,
  end_utc: instant.nullable(),
  start_local: localInstant,
  end_local: localInstant.nullable(),
  break_ms: int,
  gross_ms: int,
  net_ms: int,
  /** A correction added, moved or removed an event of this shift. */
  edited: z.boolean(),
  /** Still running (no clock-out yet) when the export was made. */
  open: z.boolean(),
  /** Crosses midnight in Brussels; the shift belongs to the day it started. */
  overnight: z.boolean(),
});
export type ExportShift = z.output<typeof exportShiftSchema>;

export const exportRowSchema = z.strictObject({
  day,
  employee_id: z.uuid(),
  employee_code: z.string().nullable(),
  employee_name: z.string(),
  shifts: z.array(exportShiftSchema),
  planned_ms: int,
  worked_net_ms: int,
  /** worked_net_ms - planned_ms. Factual, no judgement. */
  deviation_ms: int,
  edited: z.boolean(),
});
export type ExportRow = z.output<typeof exportRowSchema>;

export const exportContentSchema = z.strictObject({
  format_version: z.literal(EXPORT_FORMAT_VERSION),
  organization_id: z.uuid(),
  created_by: z.uuid(),
  generated_at: instant,
  period: z.strictObject({ from: day, to: day, timezone: z.literal(EXPORT_TIMEZONE) }),
  /** Null: every site of the organization. */
  site_ids: z.array(z.uuid()).nullable(),
  rows: z.array(exportRowSchema),
});
export type ExportContent = z.output<typeof exportContentSchema>;
