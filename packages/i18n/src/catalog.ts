/**
 * nl-BE copy catalog, nested by feature. Keep every UI string here — never
 * inline literals in `apps/web` components (enforced by `react/jsx-no-literals`).
 */
export const catalog = {
  common: {
    appName: "Cloxa",
    greeting: "Hallo {name}",
  },
  landing: {
    title: "Cloxa",
    subtitle: "Tijdsregistratie voor Belgische teams.",
  },
  app: {
    heading: "Mijn tijdsregistratie",
  },
  kiosk: {
    heading: "Kiosk",
  },
  manage: {
    heading: "Beheer",
  },
  errors: {
    notFoundTitle: "Pagina niet gevonden",
    notFoundBody: "Deze pagina bestaat niet of is verplaatst.",
    genericTitle: "Er ging iets mis",
    genericBody: "Probeer het opnieuw. Als dit blijft gebeuren, neem contact op.",
    retry: "Opnieuw proberen",
  },
} as const;

export type Catalog = typeof catalog;
