import type { CatalogKey } from "@cloxa/i18n";

/** The catalog key for an employee's statute, e.g. "Bediende". */
export const STATUTE_LABEL_KEY: Record<string, CatalogKey> = {
  bediende: "manageTeam.statuteBediende",
  arbeider: "manageTeam.statuteArbeider",
  student: "manageTeam.statuteStudent",
  flexi: "manageTeam.statuteFlexi",
  interim: "manageTeam.statuteInterim",
  other: "manageTeam.statuteOther",
};
