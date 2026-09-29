import { describe, expect, it } from "vitest";

import { parsePilotForm, readPilotForm } from "./form";

const VALID = {
  company: "Bakkerij Zon",
  vat: "BE 0403.019.261",
  name: "Jo Peeters",
  email: " Jo@Example.TEST ",
  phone: "",
  employees: "10-49",
  sector: "horeca",
  message: "",
  consent: "on",
  website: "",
};

describe("parsePilotForm", () => {
  it("normalises a valid request", () => {
    const result = parsePilotForm(VALID);
    expect(result).toEqual({
      ok: true,
      data: {
        company: "Bakkerij Zon",
        vat: "BE0403019261",
        name: "Jo Peeters",
        email: "jo@example.test",
        phone: "",
        employees: "10-49",
        sector: "horeca",
        message: "",
      },
    });
  });

  it("names every field that is wrong, and keeps what was typed", () => {
    const result = parsePilotForm({
      ...VALID,
      company: "  ",
      vat: "BE0403019262",
      email: "geen-email",
      employees: "",
      sector: "piraten",
      consent: "",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual([
      "company",
      "consent",
      "email",
      "employees",
      "sector",
      "vat",
    ]);
    expect(result.fieldErrors.vat).toBe(
      "Dit ondernemingsnummer klopt niet. Kijk het even na.",
    );
    expect(result.values.vat).toBe("BE0403019262");
    expect(result.values.email).toBe("geen-email");
  });

  it("caps the message at 1000 characters and the phone at 40", () => {
    expect(parsePilotForm({ ...VALID, message: "a".repeat(1000) }).ok).toBe(true);
    const long = parsePilotForm({
      ...VALID,
      message: "a".repeat(1001),
      phone: "1".repeat(41),
    });
    expect(long.ok).toBe(false);
    if (long.ok) return;
    expect(Object.keys(long.fieldErrors).sort()).toEqual(["message", "phone"]);
  });

  it("only takes the checkbox value `on` as consent", () => {
    expect(parsePilotForm({ ...VALID, consent: "true" }).ok).toBe(false);
    expect(parsePilotForm({ ...VALID, consent: "on" }).ok).toBe(true);
  });
});

describe("readPilotForm", () => {
  it("reads strings only and treats files and missing fields as empty", () => {
    const form = new FormData();
    form.set("company", "Bakkerij Zon");
    form.set("vat", new File(["x"], "x.txt"));
    const raw = readPilotForm(form);
    expect(raw["company"]).toBe("Bakkerij Zon");
    expect(raw["vat"]).toBe("");
    expect(raw["website"]).toBe("");
  });
});
