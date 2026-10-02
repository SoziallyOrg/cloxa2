import { describe, expect, it } from "vitest";

import { clampProgress, cringGeometry } from "./cring-geometry";

describe("cringGeometry", () => {
  it("draws no progress arc at 0, only the track", () => {
    const g = cringGeometry(0, 200);
    expect(g.progressPath).toBeNull();
    expect(g.trackPath).toBe("M204.2 55.8A105 105 0 1 0 204.2 204.2");
  });

  it("ends a quarter of the way (67.5 degrees) at the top-left side of the ring", () => {
    const g = cringGeometry(0.25, 200);
    // -45 - 67.5 = -112.5 degrees.
    expect(g.end.x).toBeCloseTo(130 + 105 * Math.cos((-112.5 * Math.PI) / 180), 1);
    expect(g.end.y).toBeCloseTo(130 + 105 * Math.sin((-112.5 * Math.PI) / 180), 1);
    expect(g.progressPath).toMatch(/^M204.2 55.8A105 105 0 0 0 /);
  });

  it("switches to the large arc past 180 degrees (two thirds of 270)", () => {
    expect(cringGeometry(2 / 3 - 0.01, 200).progressPath).toMatch(/ 0 0 0 /);
    expect(cringGeometry(2 / 3 + 0.01, 200).progressPath).toMatch(/ 0 1 0 /);
  });

  it("is full at 1 and ends where the track ends", () => {
    const g = cringGeometry(1, 200);
    expect(g.end).toEqual({ x: 204.2, y: 204.2 });
    expect(g.progressPath).toBe("M204.2 55.8A105 105 0 1 0 204.2 204.2");
  });

  it("clamps above 1 and below 0, and ignores NaN", () => {
    expect(cringGeometry(3, 200).progress).toBe(1);
    expect(cringGeometry(3, 200).progressPath).toBe(cringGeometry(1, 200).progressPath);
    expect(cringGeometry(-1, 200).progressPath).toBeNull();
    expect(clampProgress(Number.NaN)).toBe(0);
  });

  it("uses a thicker stroke and bigger dot for small rings", () => {
    expect(cringGeometry(0.5, 46)).toMatchObject({ strokeWidth: 30, dotRadius: 22 });
    expect(cringGeometry(0.5, 250)).toMatchObject({ strokeWidth: 24, dotRadius: 17 });
  });
});
