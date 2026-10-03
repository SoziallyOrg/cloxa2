import { describe, expect, it } from "vitest";

import { currentSettings, validateSettingsForm } from "./settings-form";

const valid = {
  retentionYears: "5",
  offlineClocking: true,
  offlineMaxSkewMinutes: "240",
  correctionMaxAgeDays: "60",
};

describe("validateSettingsForm", () => {
  it("accepts values within the bounds and turns them into numbers", () => {
    expect(validateSettingsForm({ ...valid, retentionYears: " 10 " })).toEqual({
      ok: true,
      values: {
        retentionYears: 10,
        offlineClocking: true,
        offlineMaxSkewMinutes: 240,
        correctionMaxAgeDays: 60,
      },
    });
  });

  it("refuses a retention below 5 or above 10 years", () => {
    expect(validateSettingsForm({ ...valid, retentionYears: "4" })).toEqual({
      ok: false,
      invalidFields: ["retentionYears"],
    });
    expect(validateSettingsForm({ ...valid, retentionYears: "11" })).toEqual({
      ok: false,
      invalidFields: ["retentionYears"],
    });
  });

  it("refuses empty, decimal and out-of-range numbers per field", () => {
    const result = validateSettingsForm({
      ...valid,
      offlineMaxSkewMinutes: "4321",
      correctionMaxAgeDays: "1.5",
    });
    expect(result).toEqual({
      ok: false,
      invalidFields: ["offlineMaxSkewMinutes", "correctionMaxAgeDays"],
    });
    expect(validateSettingsForm({ ...valid, correctionMaxAgeDays: "" })).toEqual({
      ok: false,
      invalidFields: ["correctionMaxAgeDays"],
    });
    expect(validateSettingsForm({ ...valid, offlineMaxSkewMinutes: "0" })).toEqual({
      ok: false,
      invalidFields: ["offlineMaxSkewMinutes"],
    });
  });

  it("refuses unknown fields and a missing switch", () => {
    expect(validateSettingsForm({ ...valid, extra: "1" }).ok).toBe(false);
    const withoutSwitch: Record<string, unknown> = { ...valid };
    delete withoutSwitch["offlineClocking"];
    expect(validateSettingsForm(withoutSwitch)).toEqual({
      ok: false,
      invalidFields: ["offlineClocking"],
    });
  });
});

describe("currentSettings", () => {
  it("fills the database defaults for keys never set", () => {
    expect(currentSettings({ location_capture: "off", retention_years: 5 })).toEqual({
      retentionYears: 5,
      offlineClocking: true,
      offlineMaxSkewMinutes: 240,
      correctionMaxAgeDays: 60,
    });
  });

  it("reads stored values", () => {
    expect(
      currentSettings({
        retention_years: 7,
        offline_clocking: false,
        offline_max_skew_minutes: 30,
        correction_max_age_days: 14,
      }),
    ).toEqual({
      retentionYears: 7,
      offlineClocking: false,
      offlineMaxSkewMinutes: 30,
      correctionMaxAgeDays: 14,
    });
  });
});
