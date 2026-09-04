import { beforeEach, describe, expect, it, vi } from "vitest";
import { nlBE } from "@/i18n/nl-BE";
import { manifestWire, recordWire } from "@/lib/time-exports/fixtures.test-data";

const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  auth: vi.fn(),
  rpc: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
import {
  createTimeExportAction,
  previewTimeExportAction,
} from "@/lib/time-exports/actions";

const requestId = "90000000-0000-4000-8000-000000000001";
function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const dates = { period_start_local: "2010-10-31", period_end_local: "2010-10-31" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-03T12:00:00Z"));
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.auth.mockResolvedValue({ state: "authorized", role: "manager" });
});

describe("time export actions", () => {
  it("previews with dates only and validates provider response", async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        timezone: "Europe/Brussels",
        ...dates,
        utc_start_inclusive: "2010-10-30T22:00:00.000000Z",
        utc_end_exclusive: "2010-10-31T23:00:00.000000Z",
        record_count: 1,
        employee_count: 1,
        total_duration_microseconds: "7200000001",
        blockers: [],
        warnings: [],
        records: [recordWire],
      },
      error: null,
    });
    expect((await previewTimeExportAction(form(dates))).status).toBe("success");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("preview_time_export", dates);
  });

  it("creates with exactly operation, period and confirmation", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          result_code: "created",
          did_create: true,
          export_id: manifestWire.export_id,
          manifest: manifestWire,
        },
      ],
      error: null,
    });
    const result = await createTimeExportAction(
      form({ request_id: requestId, ...dates, confirmed: "true" }),
    );
    expect(result.manifest?.exportId).toBe(manifestWire.export_id);
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("create_time_export", {
      request_id: requestId,
      ...dates,
      confirmed: true,
    });
    expect(mocks.revalidate).toHaveBeenCalledExactlyOnceWith("/manager/exports");
  });

  it.each([
    "organization_id",
    "worksite_id",
    "employee_count",
    "record_count",
    "total_duration_microseconds",
    "timezone",
    "version",
  ])("rejects browser authority field %s", async (key) => {
    const input = form({
      request_id: requestId,
      ...dates,
      confirmed: "true",
      [key]: "forged",
    });
    expect((await createTimeExportAction(input)).status).toBe("error");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { state: "anonymous" },
    { state: "unauthorized" },
    { state: "unsupported" },
    { state: "authorized", role: "employee" },
  ])("fails closed for authorization %#", async (context) => {
    mocks.auth.mockResolvedValue(context);
    expect(
      (
        await createTimeExportAction(
          form({ request_id: requestId, ...dates, confirmed: "true" }),
        )
      ).message,
    ).toBe(nlBE.managerExports.createFailure);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["no_records", nlBE.managerExports.blockers.noRecords],
    ["open_entry", nlBE.managerExports.blockers.openEntry],
    ["pending_correction", nlBE.managerExports.blockers.pendingCorrection],
    ["row_limit", nlBE.managerExports.blockers.rowLimit],
    ["artifact_too_large", nlBE.managerExports.blockers.artifactTooLarge],
  ])("maps safe blocker %s", async (code, message) => {
    mocks.rpc.mockResolvedValue({
      data: [{ result_code: code, did_create: false, export_id: null, manifest: null }],
      error: null,
    });
    expect(
      await createTimeExportAction(
        form({ request_id: requestId, ...dates, confirmed: "true" }),
      ),
    ).toEqual({ status: "error", message });
  });

  it("contains provider details and rejects inconsistent responses", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "employee name and database detail" },
    });
    expect(
      (
        await createTimeExportAction(
          form({ request_id: requestId, ...dates, confirmed: "true" }),
        )
      ).message,
    ).toBe(nlBE.managerExports.createFailure);
    mocks.rpc.mockResolvedValue({
      data: [
        {
          result_code: "created",
          did_create: true,
          export_id: requestId,
          manifest: manifestWire,
        },
      ],
      error: null,
    });
    expect(
      (
        await createTimeExportAction(
          form({ request_id: requestId, ...dates, confirmed: "true" }),
        )
      ).status,
    ).toBe("error");
  });
});

it("explains break-aware export blocker without artifact", async () => {
  mocks.rpc.mockResolvedValue({
    data: [
      {
        result_code: "break_data_requires_v2",
        did_create: false,
        export_id: null,
        manifest: null,
      },
    ],
    error: null,
  });
  expect(
    await createTimeExportAction(
      form({ ...dates, request_id: requestId, confirmed: "true" }),
    ),
  ).toEqual({
    status: "error",
    message: nlBE.managerExports.blockers.breakDataRequiresV2,
  });
  expect(mocks.revalidate).not.toHaveBeenCalled();
});
