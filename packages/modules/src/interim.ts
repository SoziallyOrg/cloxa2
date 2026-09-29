/**
 * Temporary agency workers (legal-notes §1.9): the user company registers
 * their working time; the agency usually needs the hours for payroll. This
 * module keeps the agency and a reference per worker, and lets an export
 * hold only one agency's workers.
 */
import { z } from "zod";

import type { ExportDayInput, ModuleDefinition } from "./types";

export const interimData = z.strictObject({
  agency_name: z.string().trim().min(1).max(120),
  agency_reference: z.string().trim().min(1).max(64).optional(),
});
export type InterimData = z.output<typeof interimData>;

function parseData(raw: unknown): InterimData | null {
  const parsed = interimData.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** The worker's agency, as saved; null when none (or unreadable). */
export function interimAgency(data: unknown): string | null {
  return parseData(data)?.agency_name ?? null;
}

export const interim: ModuleDefinition = {
  id: "interim",
  label: "modules.interim.label",
  description: "modules.interim.description",
  statutes: ["interim"],
  configChoices: [],
  configSchema: z.strictObject({}),
  employeeFields: interimData,
  fields: [
    {
      key: "agency_name",
      kind: "text",
      label: "modules.interim.fieldAgencyName",
      hint: "modules.interim.fieldAgencyNameHint",
      required: true,
      maxLength: 120,
    },
    {
      key: "agency_reference",
      kind: "text",
      label: "modules.interim.fieldAgencyReference",
      hint: "modules.interim.fieldAgencyReferenceHint",
      required: false,
      maxLength: 64,
    },
  ],
  needsYearToDate: false,
  counters: () => [],
  hints: () => [],
  exportColumns: [
    { key: "agency_name", header: "modules.interim.csvAgencyName", kind: "text" },
    {
      key: "agency_reference",
      header: "modules.interim.csvAgencyReference",
      kind: "text",
    },
  ],
  exportValues(input: ExportDayInput) {
    const data = parseData(input.data);
    return {
      agency_name: data?.agency_name ?? null,
      agency_reference: data?.agency_reference ?? null,
    };
  },
};
