import type { BreakCode } from "./model";
export const breakCopy = {
  title: "Pauzes corrigeren",
  reviewTitle: "Pauzeaanvragen beoordelen",
  description:
    "Vraag een correctie aan voor een afgesloten werkperiode. De oorspronkelijke pauze en eerdere beslissingen blijven in de geschiedenis staan.",
  reviewDescription:
    "Vergelijk de vastgelegde werkperiode en pauze met het voorstel. Alleen een bevestigde goedkeuring verandert de geldende pauze.",
  failure: "Verwerking niet bevestigd. Probeer opnieuw met dezelfde gegevens.",
  invalid: "Controleer de velden. Vul een reden en geldige Belgische datum en tijd in.",
  gap: "Deze lokale tijd bestaat niet door de omschakeling naar zomertijd. Kies een andere tijd.",
  ambiguous:
    "Deze tijd komt twee keer voor. Kies de eerste of tweede keer bij de herhaalde tijd.",
  kinds: {
    missed_break: "Vergeten pauze",
    adjustment: "Pauze aanpassen",
    removal: "Pauze verwijderen",
  },
  statuses: {
    pending: "In afwachting",
    withdrawn: "Ingetrokken",
    approved: "Goedgekeurd",
    rejected: "Afgewezen",
  },
  results: {
    submitted: "Pauzeaanvraag ingediend.",
    withdrawn: "Pauzeaanvraag ingetrokken.",
    approved: "Pauzeaanvraag goedgekeurd. Een nieuwe versie is vastgelegd.",
    rejected: "Pauzeaanvraag afgewezen.",
    already_terminal: "Deze aanvraag is al afgehandeld. Bekijk de geschiedenis.",
    closed_shift_required: "Kies een afgesloten werkperiode.",
    stale_request:
      "De vastgelegde versie is veranderd. Dien een nieuwe aanvraag in; trek de oude aanvraag in of wijs ze af.",
    pending_time_correction:
      "Voor deze werkperiode wacht een tijdcorrectie op afhandeling.",
    pending_break_correction:
      "Voor deze werkperiode wacht al een pauzeaanvraag op afhandeling.",
    invalid_interval:
      "De pauze moet volledig binnen de werkperiode vallen en een positief interval hebben.",
    overlap: "Deze pauze overlapt een geldende pauze.",
    unchanged: "Het voorstel verandert de pauze niet.",
    unavailable: "Deze aanvraag kan nu niet worden goedgekeurd.",
  } satisfies Record<BreakCode, string>,
};
