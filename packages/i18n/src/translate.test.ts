import { describe, expect, it } from "vitest";

import { t } from "./translate";

describe("t", () => {
  it("resolves a plain catalog message", () => {
    expect(t("common.appName")).toBe("Cloxa");
  });

  it("resolves a nested catalog message", () => {
    expect(t("errors.notFoundTitle")).toBe("Pagina niet gevonden");
  });

  it("interpolates ICU placeholders", () => {
    expect(t("common.greeting", { name: "Kim" })).toBe("Hallo Kim");
  });

  it("throws for a missing key", () => {
    // @ts-expect-error -- deliberately invalid key to exercise the runtime guard
    expect(() => t("nope.missing")).toThrow(/Missing i18n key/);
  });
});
