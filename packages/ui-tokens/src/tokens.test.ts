import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { colors, tileColors } from "./tokens";

const AA_TEXT = 4.5;
const AA_LARGE = 3;

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

for (const scheme of ["light", "dark"] as const) {
  const c = colors[scheme];
  // Every background text can sit on: the page, a grouped page, a row, a fill.
  const backgrounds = {
    paper: c.paper,
    grouped: c.grouped,
    surface: c.surface,
    fill: c.fill,
    "grouped (sheet)": c.groupedElevated,
    "surface (sheet)": c.surfaceElevated,
    // Alerts and action sheets: the translucent material over the dimmed page.
    material: scheme === "light" ? "#f0f0f0" : "#1e1e20",
  };

  describe(`${scheme} scheme`, () => {
    for (const [name, background] of Object.entries(backgrounds)) {
      it(`ink, ink-2 and every status colour reach AA text on ${name}`, () => {
        for (const text of [c.ink, c.ink2, c.working, c.break, c.attention, c.danger]) {
          expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(AA_TEXT);
        }
      });

      it(`ink-3 reaches AA large text on ${name}`, () => {
        expect(contrastRatio(c.ink3, background)).toBeGreaterThanOrEqual(AA_LARGE);
      });
    }

    it("ink keeps AAA contrast for body text on the page", () => {
      expect(contrastRatio(c.ink, c.paper)).toBeGreaterThanOrEqual(7);
    });

    it("the selected segment label reaches AA on its thumb", () => {
      expect(contrastRatio(c.ink, c.thumb)).toBeGreaterThanOrEqual(AA_TEXT);
    });

    it("the primary button (paper on ink) reaches AA", () => {
      expect(contrastRatio(c.paper, c.ink)).toBeGreaterThanOrEqual(AA_TEXT);
    });
  });
}

describe("icon tiles", () => {
  it("keep a white glyph at 3:1 or more", () => {
    for (const tile of Object.values(tileColors)) {
      expect(contrastRatio("#ffffff", tile)).toBeGreaterThanOrEqual(AA_LARGE);
    }
  });
});
