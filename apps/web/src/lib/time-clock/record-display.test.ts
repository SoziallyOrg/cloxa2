import { expect, it } from "vitest";
import { recordRange } from "./record-display";
it("one short range for same-day break", () =>
  expect(recordRange("2026-09-04T11:57:12Z", "2026-09-04T11:58:24Z")).toBe(
    "13:57–13:58",
  ));
it("one date for ordinary registration", () =>
  expect(recordRange("2026-09-04T06:00:12Z", "2026-09-04T14:30:27Z", true)).toBe(
    "04/09/2026 08:00–16:30",
  ));
it("retains both dates overnight", () =>
  expect(recordRange("2026-09-04T21:00:00Z", "2026-09-05T01:00:00Z")).toBe(
    "04/09/2026 23:00–05/09/2026 03:00",
  ));
it("distinguishes repeated winter hours", () =>
  expect(recordRange("2026-10-25T00:30:00Z", "2026-10-25T01:30:00Z")).toBe(
    "02:30 (eerste keer)–02:30 (tweede keer)",
  ));
it("labels open end without invented timestamp", () =>
  expect(recordRange("2026-09-04T06:00:00Z", null)).toBe("08:00–Bezig"));
