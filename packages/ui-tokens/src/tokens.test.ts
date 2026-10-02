import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { colors } from "./tokens";

const AA_TEXT = 4.5;
const AA_LARGE = 3;
const c = colors.light;

describe("contrastRatio", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

// Every background text can sit on: the page, a card, a soft fill, the toggle.
const lightBackgrounds = {
  paper: c.paper,
  card: c.card,
  fill: c.fill,
  toggle: c.toggle,
};

describe("text on light surfaces", () => {
  for (const [name, background] of Object.entries(lightBackgrounds)) {
    it(`ink, ink-2, forest and the status text colours reach AA on ${name}`, () => {
      for (const text of [c.ink, c.ink2, c.forest, c.attention, c.danger, c.breakInk]) {
        expect(contrastRatio(text, background)).toBeGreaterThanOrEqual(AA_TEXT);
      }
    });

    it(`ink-3 reaches AA large text on ${name}`, () => {
      expect(contrastRatio(c.ink3, background)).toBeGreaterThanOrEqual(AA_LARGE);
    });
  }

  it("input borders reach 3:1 on card and paper", () => {
    expect(contrastRatio(c.field, c.card)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(c.field, c.paper)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("ink keeps AAA contrast for body text on the page", () => {
    expect(contrastRatio(c.ink, c.paper)).toBeGreaterThanOrEqual(7);
  });
});

describe("text on brand surfaces", () => {
  it("lime is a background: forest-deep text on lime reaches AA", () => {
    expect(contrastRatio(c.forestDeep, c.lime)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("white and the secondary text reach AA on forest", () => {
    expect(contrastRatio("#ffffff", c.forest)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.onForest2, c.forest)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("lime stays visible as a non-text dot on forest", () => {
    expect(contrastRatio(c.lime, c.forest)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("the pause block: amber-ink text on amber, white text on forest", () => {
    expect(contrastRatio(c.breakInk, c.break)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the attention block: its ink on the soft red", () => {
    expect(contrastRatio(c.dangerTintInk, c.dangerTint)).toBeGreaterThanOrEqual(
      AA_TEXT,
    );
  });

  it("the primary button (white on forest) and destructive button (white on danger) reach AA", () => {
    expect(contrastRatio(c.card, c.forest)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(c.card, c.danger)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the selected toggle label reaches AA on its white tile", () => {
    expect(contrastRatio(c.ink, c.thumb)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("the bar red is only used for non-text (>= 3:1 on paper)", () => {
    expect(contrastRatio(c.dangerBar, c.paper)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
