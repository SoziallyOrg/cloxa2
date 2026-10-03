import { describe, expect, it } from "vitest";

import { formatPilotMail, singleLine } from "./mail";

const REQUEST = {
  company: "Bakkerij Zon",
  vat: "BE0403019261",
  name: "Jo Peeters",
  email: "jo@example.test",
  phone: "",
  employees: "10-49",
  sector: "horeca",
  message: "",
} as const;

describe("formatPilotMail", () => {
  it("lists the request as plain text", () => {
    const mail = formatPilotMail({
      ...REQUEST,
      phone: "0470 12 34 56",
      message: "Hallo",
    });
    expect(mail.subject).toBe("Nieuwe pilotaanvraag: Bakkerij Zon");
    expect(mail.text).toContain("Bedrijf: Bakkerij Zon");
    expect(mail.text).toContain("Ondernemingsnummer: BE0403019261");
    expect(mail.text).toContain("E-mail: jo@example.test");
    expect(mail.text).toContain("Telefoon: 0470 12 34 56");
    expect(mail.text).toContain("Medewerkers: 10 tot 49");
    expect(mail.text).toContain("Bericht:\nHallo");
  });

  it("shows a dash for what was left empty", () => {
    const mail = formatPilotMail(REQUEST);
    expect(mail.text).toContain("Telefoon: -");
    expect(mail.text).toContain("Bericht:\n-");
  });

  it("never lets a line break in the company name reach the subject", () => {
    const mail = formatPilotMail({
      ...REQUEST,
      company: "Zon\r\nBcc: iemand@example.test",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).toBe("Nieuwe pilotaanvraag: Zon Bcc: iemand@example.test");
  });
});

describe("singleLine", () => {
  it("replaces control characters and caps the length", () => {
    expect(singleLine("a\tb\u0000c d")).toBe("a b c d");
    expect(singleLine("x".repeat(200))).toHaveLength(80);
  });
});
