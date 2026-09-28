import { describe, expect, it } from "vitest";

import {
  authAttempt,
  authLinkFailure,
  inviteMember,
  kioskClock,
  kioskPair,
  kioskStatus,
  requestCorrection,
  revokeInvitation,
  RpcError,
  schedulePatternSchema,
  setEmployeePin,
  scheduleForInput,
  signOutEverywhere,
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
