import { describe, expect, it } from "vitest";
import { parseTeam, parseTeamResult, teamInputSchema, type TeamInput } from "./model";
import { TeamOperations } from "./operations";

const id = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";
const context = { organization_id: id, worksite_id: id };
const blockers = {
  has_open_shift: false,
  has_open_break: false,
  pending_time_correction_count: 0,
  pending_break_correction_count: 2,
};
const employee = {
  membership_id: id,
  display_name: "Fictief",
  employee_code: null,
  account_email: null,
  membership_status: "active",
  created_at: "2026-09-01T09:00:00Z",
  activated_at: null,
  ...blockers,
};
const invitation = {
  email: "synthetic@example.test",
  status: "pending",
  created_at: "2026-09-01T09:00:00Z",
  expires_at: "2026-09-09T09:00:00Z",
  accepted_at: null,
  revoked_at: null,
};
const view = {
  request_id: id,
  ...context,
  organization_name: "Fictief",
  worksite_name: "Werkplek",
  timezone: "Europe/Brussels",
  employees: [employee],
  invitations: [invitation],
};
const profile: TeamInput = {
  action: "update_profile",
  request_id: id,
  target_membership_id: id,
  display_name: "Fictief",
  employee_code: null,
};
const settings: TeamInput = {
  action: "update_settings",
  request_id: id,
  organization_name: "Fictief",
  worksite_name: "Werkplek",
};
const status: TeamInput = {
  action: "suspend",
  request_id: id,
  target_membership_id: id,
  confirmed: true,
};
const profileResult = {
  request_id: id,
  target_membership_id: id,
  result_code: "updated",
  did_change: true,
  display_name: "Fictief",
  employee_code: null,
};
const settingsResult = {
  request_id: id,
  ...context,
  organization_name: "Fictief",
  worksite_name: "Werkplek",
  timezone: "Europe/Brussels",
  result_code: "updated",
  did_change: true,
};
const statusResult = {
  request_id: id,
  target_membership_id: id,
  result_code: "suspended",
  did_change: true,
  membership_status: "suspended",
  ...blockers,
};

it("accepts exact bounded read with nullable fields and no invented email", () => {
  expect(parseTeam(view, id, id)).toEqual(view);
  expect(parseTeam({ ...view, employees: [], invitations: [] }, id, id)).not.toBeNull();
});
it.each(Object.keys(view))("rejects missing read key %s", (key) => {
  const bad: Record<string, unknown> = { ...view };
  delete bad[key];
  expect(parseTeam(bad, id, id)).toBeNull();
});
it.each(Object.keys(employee))("rejects missing employee key %s", (key) => {
  const bad: Record<string, unknown> = { ...employee };
  delete bad[key];
  expect(parseTeam({ ...view, employees: [bad] }, id, id)).toBeNull();
});
it.each(Object.keys(invitation))("rejects missing invitation key %s", (key) => {
  const bad: Record<string, unknown> = { ...invitation };
  delete bad[key];
  expect(parseTeam({ ...view, invitations: [bad] }, id, id)).toBeNull();
});
it.each([
  { extra: true },
  { request_id: other },
  { organization_id: other },
  { timezone: "UTC" },
  { employees: [{ ...employee, user_id: id }] },
  { invitations: [{ ...invitation, token: id }] },
  { employees: [{ ...employee, account_email: "broken" }] },
  { employees: [{ ...employee, pending_time_correction_count: -1 }] },
  { employees: [{ ...employee, pending_break_correction_count: 1.2 }] },
  { employees: [{ ...employee, activated_at: "yesterday" }] },
  { employees: [{ ...employee, membership_status: "manager" }] },
  { employees: [employee, employee] },
  { employees: Array(101).fill(employee) },
  { invitations: Array(101).fill(invitation) },
  { invitations: [{ ...invitation, status: "accepted" }] },
  { invitations: [{ ...invitation, status: "revoked" }] },
])("rejects malformed read %#", (patch) =>
  expect(parseTeam({ ...view, ...patch }, id, id)).toBeNull(),
);

describe.each([
  ["profile", profile, profileResult],
  ["settings", settings, settingsResult],
  ["status", status, statusResult],
] as const)("%s response", (_name, input, result) => {
  it("accepts exact correlated result", () =>
    expect(parseTeamResult(result, input, context)).toEqual(result));
  it.each(Object.keys(result))("rejects absent key %s", (key) => {
    const bad: Record<string, unknown> = { ...result };
    delete bad[key];
    expect(parseTeamResult(bad, input, context)).toBeNull();
  });
  it.each([
    null,
    [],
    {},
    "provider",
    { ...result, extra: true },
    { ...result, request_id: other },
    { ...result, did_change: false },
    { ...result, result_code: "unrecognized" },
  ])("rejects malformed result %#", (bad) =>
    expect(parseTeamResult(bad, input, context)).toBeNull(),
  );
});
it("correlates target, normalized values, organization and worksite", () => {
  for (const patch of [
    { target_membership_id: other },
    { display_name: "Other" },
    { employee_code: "Other" },
  ])
    expect(
      parseTeamResult({ ...profileResult, ...patch }, profile, context),
    ).toBeNull();
  for (const patch of [
    { organization_id: other },
    { worksite_id: other },
    { worksite_name: "Other" },
    { organization_name: "Other" },
    { timezone: "UTC" },
  ])
    expect(
      parseTeamResult({ ...settingsResult, ...patch }, settings, context),
    ).toBeNull();
  expect(
    parseTeamResult({ ...statusResult, target_membership_id: other }, status, context),
  ).toBeNull();
});
it.each([
  ["suspend", "suspended", "suspended", true, false, false, true],
  ["reactivate", "reactivated", "active", true, false, false, true],
  ["suspend", "already_suspended", "suspended", false, false, false, true],
  ["reactivate", "already_active", "active", false, false, false, true],
  ["suspend", "open_shift", "active", false, true, false, true],
  ["suspend", "open_break", "active", false, true, true, true],
  ["reactivate", "ambiguous_membership", "suspended", false, false, false, true],
  ["suspend", "unavailable", "inactive", false, false, false, true],
  ["suspend", "reactivated", "active", true, false, false, false],
  ["reactivate", "suspended", "suspended", true, false, false, false],
  ["suspend", "suspended", "active", true, false, false, false],
  ["suspend", "suspended", "suspended", true, true, false, false],
  ["reactivate", "open_shift", "active", false, true, false, false],
  ["suspend", "open_shift", "active", false, false, false, false],
  ["suspend", "open_shift", "active", false, true, true, false],
  ["suspend", "open_break", "active", false, false, false, false],
  ["suspend", "ambiguous_membership", "suspended", false, false, false, false],
  ["suspend", "unavailable", "active", false, false, false, false],
] as const)(
  "action/result/status compatibility %#",
  (
    action,
    result_code,
    membership_status,
    did_change,
    has_open_shift,
    has_open_break,
    valid,
  ) => {
    const result = parseTeamResult(
      {
        ...statusResult,
        result_code,
        membership_status,
        did_change,
        has_open_shift,
        has_open_break,
      },
      { ...status, action },
      context,
    );
    expect(result !== null).toBe(valid);
  },
);
it("requires exact confirmation semantics", () => {
  const result = {
    ...statusResult,
    result_code: "confirmation_required",
    did_change: false,
    membership_status: "active",
  };
  expect(parseTeamResult(result, { ...status, confirmed: false }, context)).toEqual(
    result,
  );
  expect(parseTeamResult(result, status, context)).toBeNull();
  expect(
    parseTeamResult(statusResult, { ...status, confirmed: false }, context),
  ).toBeNull();
});
it("normalizes ASCII spaces and optional code consistently with database", () => {
  expect(
    teamInputSchema.parse({
      ...profile,
      display_name: "  Fictief  ",
      employee_code: "  ",
    }),
  ).toEqual(profile);
  expect(teamInputSchema.parse({ ...profile, employee_code: "  AbC  " }).action).toBe(
    "update_profile",
  );
  expect(
    teamInputSchema.safeParse({
      ...profile,
      display_name: "😀".repeat(100),
      employee_code: "",
    }).success,
  ).toBe(true);
});
it.each([
  { display_name: " " },
  { display_name: "A".repeat(101) },
  { display_name: "\t" },
  { employee_code: "A".repeat(33) },
  { employee_code: "bad\ncode" },
  { employee_code: null },
  { role: "manager" },
  { organization_id: other },
  { action: "delete" },
])("rejects invalid profile input %#", (patch) =>
  expect(
    teamInputSchema.safeParse({ ...profile, employee_code: "", ...patch }).success,
  ).toBe(false),
);
it("retires exact confirmed blockers; preserves uncertainty and changed payload identities", () => {
  let n = 0;
  const ops = new TeamOperations(() => String(++n));
  const first = ops.request("profile-a");
  expect(ops.request("profile-a")).toBe(first);
  expect(ops.request("profile-b")).not.toBe(first);
  ops.confirm("profile-a", "mismatched");
  expect(ops.request("profile-a")).toBe(first);
  const blocked = parseTeamResult(
    { ...profileResult, result_code: "duplicate_employee_code", did_change: false },
    profile,
    context,
  );
  expect(blocked).not.toBeNull();
  ops.confirm("profile-a", first);
  expect(ops.request("profile-a")).not.toBe(first);
});
