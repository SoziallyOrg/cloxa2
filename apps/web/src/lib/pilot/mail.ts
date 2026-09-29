import type { ParsedPilotRequest } from "./form";

/**
 * The plain-text notification the operator gets for a new pilot request. Pure,
 * so it can be tested. Free text from the form is kept out of the header: a
 * line break in a company name must never become a mail header.
 */

const RANGE_LABELS: Record<ParsedPilotRequest["employees"], string> = {
  "1-9": "1 tot 9",
  "10-49": "10 tot 49",
  "50-249": "50 tot 249",
  "250+": "250 of meer",
};

/** One line, no control characters: safe for a subject. */
export function singleLine(value: string, max = 80): string {
  let line = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    // Control characters and the Unicode line separators become a space.
    line +=
      code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? " " : character;
  }
  return line.replace(/ {2,}/g, " ").trim().slice(0, max);
}

export interface PilotMail {
  subject: string;
  text: string;
}

export function formatPilotMail(request: ParsedPilotRequest): PilotMail {
  const lines = [
    "Nieuwe pilotaanvraag voor Cloxa.",
    "",
    `Bedrijf: ${request.company}`,
    `Ondernemingsnummer: ${request.vat}`,
    `Contactpersoon: ${request.name}`,
    `E-mail: ${request.email}`,
    `Telefoon: ${request.phone === "" ? "-" : request.phone}`,
    `Medewerkers: ${RANGE_LABELS[request.employees]}`,
    `Sector: ${request.sector}`,
    "",
    "Bericht:",
    request.message === "" ? "-" : request.message,
    "",
    "Bekijk de open aanvragen met: pnpm ops requests",
  ];
  return {
    subject: `Nieuwe pilotaanvraag: ${singleLine(request.company)}`,
    text: lines.join("\n"),
  };
}
