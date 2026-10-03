import { describe, expect, it } from "vitest";

import { isWideManagePage } from "./layout";

describe("isWideManagePage", () => {
  it("is wide for the timeline, tables and an employee's page", () => {
    for (const path of [
      "/manage",
      "/manage/team",
      "/manage/vragen",
      "/manage/medewerker/abc",
      "/manage/meer/exports",
      "/manage/meer/kiosks",
      "/manage/meer/audit",
    ]) {
      expect(isWideManagePage(path), path).toBe(true);
    }
  });

  it("keeps forms and the schedule editor in the readable column", () => {
    for (const path of [
      "/manage/meer",
      "/manage/meer/instellingen",
      "/manage/meer/modules",
      "/manage/meer/modules/student",
      "/manage/medewerker/abc/rooster",
      "/manage/beveiliging/instellen",
    ]) {
      expect(isWideManagePage(path), path).toBe(false);
    }
  });
});
