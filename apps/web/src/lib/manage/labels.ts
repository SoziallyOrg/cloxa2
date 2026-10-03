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

/** The word for each Vandaag status group ("Aan het werk", "Op pauze", ...). */
export const GROUP_LABEL_KEY = {
  working: "manageToday.groupWorking",
  break: "manageToday.groupBreak",
  attention: "manageToday.groupAttention",
  idle: "manageToday.groupIdle",
} as const satisfies Record<"working" | "break" | "attention" | "idle", CatalogKey>;
