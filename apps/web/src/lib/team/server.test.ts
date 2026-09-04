import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  client: vi.fn(),
  auth: vi.fn(),
  rpc: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
vi.mock("@/lib/auth/session", () => ({ getAuthContext: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { getManagerTeam } from "./server";
import { changeTeam } from "./actions";
const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const input = {
  action: "update_profile",
  request_id: id,
  target_membership_id: id,
  display_name: "Fictief",
  employee_code: "",
};
const result = {
  request_id: id,
  target_membership_id: id,
  result_code: "updated",
  did_change: true,
  display_name: "Fictief",
  employee_code: null,
};
const view = {
  organization_id: id,
  organization_name: "Fictief",
  worksite_id: other,
  worksite_name: "Werkplek",
  timezone: "Europe/Brussels",
  employees: [],
  invitations: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.client.mockResolvedValue({ rpc: mocks.rpc });
  mocks.auth.mockResolvedValue({
    state: "authorized",
    role: "manager",
    organizationId: id,
  });
  mocks.rpc.mockResolvedValue({ data: result, error: null });
});
it("uses current client for auth and RPC; confirms and refreshes exact result", async () => {
  expect((await changeTeam(input)).result).toEqual(result);
  expect(mocks.auth).toHaveBeenCalledWith(await mocks.client.mock.results[0]?.value);
  expect(mocks.client).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith("update_employee_profile", {
    request_id: id,
    target_membership_id: id,
    display_name: "Fictief",
    employee_code: null,
  });
  expect(mocks.refresh).toHaveBeenCalledWith("/manager/team");
});
it.each([
  { state: "anonymous" },
  { state: "unauthorized" },
  { state: "unsupported" },
  { state: "authorized", role: "employee" },
])("denies reads and mutations before RPC %#", async (auth) => {
  mocks.auth.mockResolvedValue(auth);
  expect(await getManagerTeam()).toBeNull();
  expect((await changeTeam(input)).result).toBeUndefined();
  expect(mocks.rpc).not.toHaveBeenCalled();
});
it.each([
  null,
  {},
  [],
  { ...result, extra: true },
  { ...result, target_membership_id: other },
  { ...result, request_id: other },
  { ...result, did_change: false },
])("preserves uncertain malformed result UUID %#", async (data) => {
  mocks.rpc.mockResolvedValue({ data, error: null });
  expect((await changeTeam(input)).result).toBeUndefined();
  expect(mocks.refresh).not.toHaveBeenCalled();
});
it("contains provider and transport errors", async () => {
  mocks.rpc.mockResolvedValue({
    data: result,
    error: { message: "private provider error secret@example.test" },
  });
  expect(await changeTeam(input)).not.toHaveProperty("result");
  expect(JSON.stringify(await changeTeam(input))).not.toMatch(
    /provider|secret@example/u,
  );
  mocks.rpc.mockRejectedValue(new Error("private provider error"));
  expect(await getManagerTeam()).toBeNull();
  expect(JSON.stringify(await changeTeam(input))).not.toContain("provider");
});
it("returns safe field errors before calling provider", async () => {
  const state = await changeTeam({ ...input, display_name: " " });
  expect(state.fieldErrors).toHaveProperty("display_name");
  expect(mocks.client).not.toHaveBeenCalled();
});
it("confirms safe blocker for browser UUID retirement", async () => {
  const blocked = {
    ...result,
    result_code: "duplicate_employee_code",
    did_change: false,
  };
  mocks.rpc.mockResolvedValue({ data: blocked, error: null });
  expect((await changeTeam(input)).result).toEqual(blocked);
});
it("keeps confirmed outcome when cache refresh fails", async () => {
  mocks.refresh.mockImplementation(() => {
    throw new Error("cache unavailable");
  });
  expect((await changeTeam(input)).result).toEqual(result);
});
it("correlates read UUID, organization and exact keys", async () => {
  mocks.rpc.mockImplementation(async (_rpc, args) => ({
    data: { ...view, request_id: args.request_id },
    error: null,
  }));
  expect(await getManagerTeam()).toMatchObject(view);
  mocks.rpc.mockImplementation(async (_rpc, args) => ({
    data: { ...view, request_id: args.request_id, token: "forbidden" },
    error: null,
  }));
  expect(await getManagerTeam()).toBeNull();
});
it("derives settings target from authorized read, never browser organization or worksite", async () => {
  const settingsInput = {
    action: "update_settings",
    request_id: id,
    organization_name: " Nieuw ",
    worksite_name: " Nieuw werk ",
  };
  mocks.rpc.mockImplementation(async (rpc, args) => ({
    data:
      rpc === "get_manager_team"
        ? { ...view, request_id: args.request_id }
        : {
            ...view,
            employees: undefined,
            invitations: undefined,
            organization_name: "Nieuw",
            worksite_name: "Nieuw werk",
            request_id: id,
            result_code: "updated",
            did_change: true,
          },
    error: null,
  }));
  // Even undefined extra keys fail exact shape validation.
  expect((await changeTeam(settingsInput)).result).toBeUndefined();
  mocks.rpc.mockImplementation(async (rpc, args) => ({
    data:
      rpc === "get_manager_team"
        ? { ...view, request_id: args.request_id }
        : {
            request_id: id,
            organization_id: id,
            worksite_id: other,
            organization_name: "Nieuw",
            worksite_name: "Nieuw werk",
            timezone: "Europe/Brussels",
            result_code: "updated",
            did_change: true,
          },
    error: null,
  }));
  expect((await changeTeam(settingsInput)).result).toHaveProperty("worksite_id", other);
  expect(mocks.rpc).toHaveBeenLastCalledWith("update_pilot_settings", {
    request_id: id,
    organization_name: "Nieuw",
    worksite_name: "Nieuw werk",
  });
});
