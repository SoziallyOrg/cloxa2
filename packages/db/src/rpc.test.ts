import { describe, expect, it } from "vitest";

import {
  authAttempt,
  authLinkFailure,
  clock,
  clockOffline,
  inviteMember,
  kioskClock,
  kioskPair,
  kioskStatus,
  offboardEmployee,
  requestCorrection,
  revokeInvitation,
  RpcError,
  schedulePatternSchema,
  setEmployeeModuleData,
  setEmployeePin,
  setOrgModule,
  updateOrgSettings,
  scheduleForInput,
  signOutEverywhere,
  submitPilotRequest,
  type CloxaClient,
} from "./rpc";

const ID_A = "7f1c6a52-4c1e-4a7e-9a55-3f7f1b2f0a01";
const ID_B = "7f1c6a52-4c1e-4a7e-9a55-3f7f1b2f0a02";
const HASH = "a".repeat(64);

interface Call {
  fn: string;
  args: unknown;
}

/** Records rpc calls and answers with a fixed response. */
function fakeClient(response: { data: unknown; error: unknown }) {
  const calls: Call[] = [];
  const client = {
    rpc: (fn: string, args?: unknown) => {
      calls.push({ fn, args });
      return Promise.resolve(response);
    },
  } as unknown as CloxaClient;
  return { client, calls };
}

describe("requestCorrection", () => {
  it("maps an adjustment to targets and proposed events", async () => {
    const { client, calls } = fakeClient({ data: { id: ID_B }, error: null });

    await requestCorrection(client, {
      kind: "adjust",
      events: [{ targetEventId: ID_A, occurredAt: "2026-09-01T08:00:00+02:00" }],
      reason: "  Vergeten in te klokken  ",
    });

    expect(calls).toEqual([
      {
        fn: "rpc_request_correction",
        args: {
          p_kind: "adjust",
          p_target_event_ids: [ID_A],
          p_proposed: {
            events: [
              { target_event_id: ID_A, occurred_at: "2026-09-01T08:00:00+02:00" },
            ],
          },
          p_reason: "Vergeten in te klokken",
        },
      },
    ]);
  });

  it("maps a removal to targets only", async () => {
    const { client, calls } = fakeClient({ data: { id: ID_B }, error: null });

    await requestCorrection(client, {
      kind: "remove",
      targetEventIds: [ID_A],
      reason: "Fout",
    });

    expect(calls[0]?.args).toEqual({
      p_kind: "remove",
      p_target_event_ids: [ID_A],
      p_proposed: {},
      p_reason: "Fout",
    });
  });

  it("rejects local times, long reasons and duplicate targets before calling", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await expect(
      requestCorrection(client, {
        kind: "add",
        events: [{ type: "clock_in", occurredAt: "2026-09-01T08:00:00", siteId: ID_A }],
        reason: "x",
      }),
    ).rejects.toThrow();
    await expect(
      requestCorrection(client, {
        kind: "remove",
        targetEventIds: [ID_A],
        reason: "x".repeat(281),
      }),
    ).rejects.toThrow();
    await expect(
      requestCorrection(client, {
        kind: "remove",
        targetEventIds: [ID_A, ID_A],
        reason: "x",
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("turns a database refusal into an RpcError with the machine code", async () => {
    const { client } = fakeClient({
      data: null,
      error: {
        message: "invalid_sequence",
        code: "P0001",
        details: "state=off type=clock_out",
      },
    });

    const error = await requestCorrection(client, {
      kind: "remove",
      targetEventIds: [ID_A],
      reason: "x",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({
      rpc: "rpc_request_correction",
      code: "P0001",
      message: "invalid_sequence",
      details: "state=off type=clock_out",
    });
  });
});

describe("schedulePatternSchema", () => {
  it("accepts sorted blocks, a 24:00 end and one overnight last block", () => {
    expect(
      schedulePatternSchema.safeParse({
        mon: [
          { start: "08:00", end: "12:00" },
          { start: "12:30", end: "24:00" },
        ],
        sat: [{ start: "22:00", end: "06:00" }],
        exceptions: [{ date: "2026-12-24", blocks: [] }],
      }).success,
    ).toBe(true);
  });

  it.each([
    [
      "overlap",
      {
        mon: [
          { start: "08:00", end: "12:00" },
          { start: "11:00", end: "13:00" },
        ],
      },
    ],
    [
      "block after overnight",
      {
        mon: [
          { start: "22:00", end: "02:00" },
          { start: "23:00", end: "23:30" },
        ],
      },
    ],
    ["zero length", { mon: [{ start: "08:00", end: "08:00" }] }],
    ["unknown day", { monday: [] }],
    ["bad time", { mon: [{ start: "8:00", end: "12:00" }] }],
    [
      "duplicate exception",
      {
        exceptions: [
          { date: "2026-12-24", blocks: [] },
          { date: "2026-12-24", blocks: [] },
        ],
      },
    ],
  ])("rejects %s", (_label, pattern) => {
    expect(schedulePatternSchema.safeParse(pattern).success).toBe(false);
  });

  it("limits schedule reads to 93 days", () => {
    expect(
      scheduleForInput.safeParse({
        employeeId: ID_A,
        from: "2027-01-01",
        to: "2027-04-03",
      }).success,
    ).toBe(true);
    expect(
      scheduleForInput.safeParse({
        employeeId: ID_A,
        from: "2027-01-01",
        to: "2027-04-04",
      }).success,
    ).toBe(false);
    expect(
      scheduleForInput.safeParse({
        employeeId: ID_A,
        from: "2027-01-02",
        to: "2027-01-01",
      }).success,
    ).toBe(false);
  });
});

describe("service and member RPCs", () => {
  it("sends hashes as bytea hex and returns the first row", async () => {
    const { client, calls } = fakeClient({
      data: [{ allowed: false, retry_after: 812, paused: false }],
      error: null,
    });
    const PAIR = "c".repeat(64);

    await expect(
      authAttempt(client, {
        kind: "otp_request",
        emailHash: HASH,
        ipHash: HASH,
        pairHash: PAIR,
      }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 812, paused: false });
    expect(calls[0]?.args).toEqual({
      p_kind: "otp_request",
      p_email_hash: `\\x${HASH}`,
      p_ip_hash: `\\x${HASH}`,
      p_subject_hash: `\\x${PAIR}`,
    });
  });

  it("sends the flow as subject for code checks and the user for TOTP", async () => {
    const { client, calls } = fakeClient({
      data: [{ allowed: true, retry_after: 0, paused: false }],
      error: null,
    });
    const FLOW = "b".repeat(64);

    await authAttempt(client, {
      kind: "otp_verify",
      emailHash: HASH,
      flowHash: FLOW,
      ipHash: HASH,
    });
    await authAttempt(client, { kind: "totp_verify", userHash: FLOW });
    await authAttempt(client, { kind: "link_verify", ipHash: HASH });

    expect(calls.map((call) => call.args)).toEqual([
      {
        p_kind: "otp_verify",
        p_email_hash: `\\x${HASH}`,
        p_ip_hash: `\\x${HASH}`,
        p_subject_hash: `\\x${FLOW}`,
      },
      {
        p_kind: "totp_verify",
        p_email_hash: null,
        p_ip_hash: null,
        p_subject_hash: `\\x${FLOW}`,
      },
      {
        p_kind: "link_verify",
        p_email_hash: null,
        p_ip_hash: `\\x${HASH}`,
        p_subject_hash: null,
      },
    ]);
  });

  it("sends a null IP (and no pair) when the client IP is unknown", async () => {
    const { client, calls } = fakeClient({
      data: [{ allowed: false, retry_after: 300, paused: true }],
      error: null,
    });

    await authAttempt(client, {
      kind: "otp_request",
      emailHash: HASH,
      ipHash: null,
      pairHash: null,
    });
    await expect(
      authAttempt(client, { kind: "link_verify", ipHash: null }),
    ).resolves.toEqual({ allowed: false, retryAfterSeconds: 300, paused: true });

    expect(calls.map((call) => call.args)).toEqual([
      {
        p_kind: "otp_request",
        p_email_hash: `\\x${HASH}`,
        p_ip_hash: null,
        p_subject_hash: null,
      },
      {
        p_kind: "link_verify",
        p_email_hash: null,
        p_ip_hash: null,
        p_subject_hash: null,
      },
    ]);
  });

  it("never lets a TOTP check carry an email", async () => {
    const { client } = fakeClient({ data: [], error: null });
    await expect(
      authAttempt(client, {
        kind: "totp_verify",
        userHash: HASH,
        emailHash: HASH,
      } as never),
    ).rejects.toThrow();
  });

  it("requires the email + IP pair exactly when the IP is known", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(
      authAttempt(client, { kind: "otp_request", emailHash: HASH } as never),
    ).rejects.toThrow();
    await expect(
      authAttempt(client, {
        kind: "otp_request",
        emailHash: HASH,
        ipHash: HASH,
        pairHash: null,
      }),
    ).rejects.toThrow();
    await expect(
      authAttempt(client, {
        kind: "otp_request",
        emailHash: HASH,
        ipHash: null,
        pairHash: HASH,
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("records a link failure with or without an IP", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await authLinkFailure(client, { ipHash: HASH });
    await authLinkFailure(client, { ipHash: null });
    expect(calls).toEqual([
      { fn: "rpc_auth_link_failure", args: { p_ip_hash: `\\x${HASH}` } },
      { fn: "rpc_auth_link_failure", args: { p_ip_hash: null } },
    ]);
  });

  it("normalizes the invited email and omits unset optional fields", async () => {
    const { client, calls } = fakeClient({ data: ID_B, error: null });

    await expect(
      inviteMember(client, {
        organizationId: ID_A,
        email: "  Nieuw@Example.TEST ",
        role: "employee",
        displayName: "Nieuwe Medewerker",
        siteIds: [ID_B],
      }),
    ).resolves.toBe(ID_B);
    expect(calls[0]?.args).toEqual({
      p_org: ID_A,
      p_email: "nieuw@example.test",
      p_role: "employee",
      p_display_name: "Nieuwe Medewerker",
      p_site_ids: [ID_B],
    });
  });

  it("returns zero revoked sessions as a number, not an error", async () => {
    const { client } = fakeClient({ data: 0, error: null });
    await expect(signOutEverywhere(client, { employeeId: ID_A })).resolves.toBe(0);
  });
});

describe("review rules", () => {
  it("rejects proposals whose times do not strictly increase", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await expect(
      requestCorrection(client, {
        kind: "add",
        events: [
          { type: "clock_in", occurredAt: "2026-09-01T08:00:00Z", siteId: ID_A },
          { type: "clock_out", occurredAt: "2026-09-01T10:00:00+02:00", siteId: ID_A },
        ],
        reason: "x",
      }),
    ).rejects.toThrow("proposed times must strictly increase");
    expect(calls).toHaveLength(0);
  });

  it("revokes an invitation by id", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });

    await expect(revokeInvitation(client, { id: ID_A })).resolves.toBeUndefined();
    expect(calls).toEqual([{ fn: "rpc_revoke_invitation", args: { p_id: ID_A } }]);
  });
});

describe("kiosk RPCs", () => {
  const SECRET = "ab".repeat(32);

  it("returns the device secret after pairing", async () => {
    const { client, calls } = fakeClient({
      data: [
        { ok: true, error_code: null, device_secret: SECRET, device_name: "Ingang" },
      ],
      error: null,
    });
    await expect(kioskPair(client, { code: "ABCD2345" })).resolves.toEqual({
      ok: true,
      deviceSecret: SECRET,
      deviceName: "Ingang",
    });
    expect(calls).toEqual([{ fn: "rpc_kiosk_pair", args: { p_code: "ABCD2345" } }]);
  });

  it("returns a refused pairing as a value", async () => {
    const { client } = fakeClient({
      data: [
        {
          ok: false,
          error_code: "pairing_paused",
          device_secret: null,
          device_name: null,
        },
      ],
      error: null,
    });
    await expect(kioskPair(client, { code: "ABCD2345" })).resolves.toEqual({
      ok: false,
      error: "pairing_paused",
    });
  });

  it("never sends a code with ambiguous characters", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(kioskPair(client, { code: "ABCD1O23" })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("maps a refused PIN with its tries left", async () => {
    const { client, calls } = fakeClient({
      data: [
        {
          ok: false,
          error_code: "pin_invalid",
          tries_left: 2,
          retry_after: null,
          state: null,
          occurred_at: null,
        },
      ],
      error: null,
    });
    await expect(
      kioskStatus(client, { deviceSecret: SECRET, employeeId: ID_A, pin: "2580" }),
    ).resolves.toEqual({
      ok: false,
      error: "pin_invalid",
      triesLeft: 2,
      retryAfterSeconds: null,
    });
    expect(calls).toEqual([
      {
        fn: "rpc_kiosk_status",
        args: { p_device_secret: SECRET, p_employee_id: ID_A, p_pin: "2580" },
      },
    ]);
  });

  it("maps a recorded kiosk event to the new state and server time", async () => {
    const { client } = fakeClient({
      data: [
        {
          ok: true,
          error_code: null,
          tries_left: null,
          retry_after: null,
          state: "working",
          occurred_at: "2026-09-29T06:02:00+00:00",
        },
      ],
      error: null,
    });
    await expect(
      kioskClock(client, {
        deviceSecret: SECRET,
        employeeId: ID_A,
        pin: "2580",
        type: "clock_in",
        idempotencyKey: ID_B,
      }),
    ).resolves.toEqual({
      ok: true,
      state: "working",
      occurredAt: "2026-09-29T06:02:00+00:00",
    });
  });

  it("rejects malformed PINs and secrets before calling", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(
      kioskStatus(client, { deviceSecret: SECRET, employeeId: ID_A, pin: "123" }),
    ).rejects.toThrow();
    await expect(
      kioskStatus(client, { deviceSecret: "nope", employeeId: ID_A, pin: "2580" }),
    ).rejects.toThrow();
    await expect(
      setEmployeePin(client, { employeeId: ID_A, pin: "1234567" }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  it("sets a PIN for an employee and turns a refusal into an RpcError", async () => {
    const { client, calls } = fakeClient({
      data: null,
      error: { message: "pin_too_simple", code: "22023" },
    });
    await expect(
      setEmployeePin(client, { employeeId: ID_A, pin: "1234" }),
    ).rejects.toMatchObject({
      name: "RpcError",
      message: "pin_too_simple",
    });
    expect(calls).toEqual([
      { fn: "rpc_set_employee_pin", args: { p_employee_id: ID_A, p_pin: "1234" } },
    ]);
  });
});

describe("clockOffline", () => {
  const input = {
    type: "clock_in" as const,
    idempotencyKey: ID_A,
    siteId: ID_B,
    capturedAt: "2026-09-28T06:02:00.000Z",
  };

  it("sends the captured time and maps a recorded event", async () => {
    const { client, calls } = fakeClient({
      data: [
        { outcome: "recorded", event_id: ID_B, correction_id: null, reason: null },
      ],
      error: null,
    });
    await expect(clockOffline(client, input)).resolves.toEqual({
      outcome: "recorded",
      eventId: ID_B,
    });
    expect(calls).toEqual([
      {
        fn: "rpc_clock_offline",
        args: {
          p_type: "clock_in",
          p_idempotency_key: ID_A,
          p_site_id: ID_B,
          p_client_captured_at: "2026-09-28T06:02:00.000Z",
        },
      },
    ]);
  });

  it("returns a correction request and a refusal as values", async () => {
    const requested = fakeClient({
      data: [
        {
          outcome: "correction_requested",
          event_id: null,
          correction_id: ID_B,
          reason: "later_event_exists",
        },
      ],
      error: null,
    });
    await expect(clockOffline(requested.client, input)).resolves.toEqual({
      outcome: "correction_requested",
      correctionId: ID_B,
      reason: "later_event_exists",
    });

    const rejected = fakeClient({
      data: [
        {
          outcome: "rejected",
          event_id: null,
          correction_id: null,
          reason: "offline_disabled",
        },
      ],
      error: null,
    });
    await expect(clockOffline(rejected.client, input)).resolves.toEqual({
      outcome: "rejected",
      reason: "offline_disabled",
    });
  });

  it("rejects a local time before calling", async () => {
    const { client, calls } = fakeClient({ data: [], error: null });
    await expect(
      clockOffline(client, { ...input, capturedAt: "2026-09-28T08:02:00" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("offboarding and org settings", () => {
  it("offboards without a last day unless one is given", async () => {
    const { client, calls } = fakeClient({ data: "2026-09-28", error: null });
    await expect(offboardEmployee(client, { employeeId: ID_A })).resolves.toBe(
      "2026-09-28",
    );
    await offboardEmployee(client, { employeeId: ID_A, leftAt: "2026-09-27" });
    expect(calls).toEqual([
      { fn: "rpc_offboard_employee", args: { p_employee_id: ID_A } },
      {
        fn: "rpc_offboard_employee",
        args: { p_employee_id: ID_A, p_left_at: "2026-09-27" },
      },
    ]);
  });

  it("maps the settings and refuses out-of-range values before calling", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    const valid = {
      organizationId: ID_A,
      retentionYears: 5,
      offlineClocking: true,
      offlineMaxSkewMinutes: 240,
      correctionMaxAgeDays: 60,
    };
    await updateOrgSettings(client, valid);
    await expect(
      updateOrgSettings(client, { ...valid, retentionYears: 4 }),
    ).rejects.toThrow();
    await expect(
      updateOrgSettings(client, { ...valid, offlineMaxSkewMinutes: 4321 }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      {
        fn: "rpc_update_org_settings",
        args: {
          p_org: ID_A,
          p_retention_years: 5,
          p_offline_clocking: true,
          p_offline_max_skew_minutes: 240,
          p_correction_max_age_days: 60,
        },
      },
    ]);
  });
});

describe("modules", () => {
  it("maps a module switch and refuses unknown modules or big configs before calling", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await setOrgModule(client, {
      organizationId: ID_A,
      module: "overuren",
      enabled: true,
      config: { sector: "horeca" },
    });
    await expect(
      setOrgModule(client, {
        organizationId: ID_A,
        module: "ciao" as "student",
        enabled: true,
        config: {},
      }),
    ).rejects.toThrow();
    await expect(
      setOrgModule(client, {
        organizationId: ID_A,
        module: "student",
        enabled: true,
        config: { note: "x".repeat(8200) },
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      {
        fn: "rpc_set_org_module",
        args: {
          p_org: ID_A,
          p_module: "overuren",
          p_enabled: true,
          p_config: { sector: "horeca" },
        },
      },
    ]);
  });

  it("maps employee module data and throws the database refusal", async () => {
    const { client, calls } = fakeClient({ data: null, error: null });
    await setEmployeeModuleData(client, {
      employeeId: ID_A,
      module: "interim",
      data: { agency_name: "Uitzend NV" },
    });
    expect(calls[0]).toEqual({
      fn: "rpc_set_employee_module_data",
      args: {
        p_employee_id: ID_A,
        p_module: "interim",
        p_data: { agency_name: "Uitzend NV" },
      },
    });

    const refused = fakeClient({
      data: null,
      error: { message: "module_disabled", code: "22023" },
    });
    await expect(
      setEmployeeModuleData(refused.client, {
        employeeId: ID_A,
        module: "student",
        data: {},
      }),
    ).rejects.toMatchObject({ name: "RpcError", message: "module_disabled" });
  });

  it("sends a work location only with a clock-in", async () => {
    const { client, calls } = fakeClient({ data: { id: ID_B }, error: null });
    await clock(client, {
      type: "clock_in",
      idempotencyKey: ID_A,
      siteId: ID_B,
      workLocation: "home",
    });
    await expect(
      clock(client, {
        type: "clock_out",
        idempotencyKey: ID_A,
        siteId: ID_B,
        workLocation: "home",
      }),
    ).rejects.toThrow();
    await expect(
      clock(client, {
        type: "clock_in",
        idempotencyKey: ID_A,
        siteId: ID_B,
        workLocation: "garden" as "home",
      }),
    ).rejects.toThrow();
    expect(calls).toEqual([
      {
        fn: "rpc_clock",
        args: {
          p_type: "clock_in",
          p_idempotency_key: ID_A,
          p_site_id: ID_B,
          p_work_location: "home",
        },
      },
    ]);
  });
});

describe("submitPilotRequest", () => {
  const base = {
    companyName: " Bakkerij Zon ",
    vatNumber: "BE0403019261",
    contactName: "Jo Peeters",
    email: " Jo@Example.TEST ",
    employeeRange: "10-49",
    sector: "horeca",
    consent: true,
    emailHash: HASH,
    ipHash: null,
  } as const;

  it("sends hashes as bytea and unset optional fields as null", async () => {
    const { client, calls } = fakeClient({ data: true, error: null });
    await expect(submitPilotRequest(client, { ...base, phone: "  " })).resolves.toBe(
      true,
    );
    expect(calls).toEqual([
      {
        fn: "rpc_submit_pilot_request",
        args: {
          p_company_name: "Bakkerij Zon",
          p_vat_number: "BE0403019261",
          p_contact_name: "Jo Peeters",
          p_email: "jo@example.test",
          p_phone: null,
          p_employee_range: "10-49",
          p_sector: "horeca",
          p_message: null,
          p_consent: true,
          p_email_hash: `\\x${HASH}`,
          p_ip_hash: null,
        },
      },
    ]);
  });

  it("reports a rate-limited request as not stored", async () => {
    const { client } = fakeClient({ data: false, error: null });
    await expect(submitPilotRequest(client, base)).resolves.toBe(false);
  });

  it("refuses missing consent, an odd VAT format and an unknown sector", async () => {
    const { client, calls } = fakeClient({ data: true, error: null });
    await expect(
      submitPilotRequest(client, { ...base, consent: false as unknown as true }),
    ).rejects.toThrow();
    await expect(
      submitPilotRequest(client, { ...base, vatNumber: "BE 0403.019.261" }),
    ).rejects.toThrow();
    await expect(
      submitPilotRequest(client, { ...base, sector: "piraten" as unknown as "horeca" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});
