import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  adminClient: vi.fn(),
  inviteUserByEmail: vi.fn(),
  adminFrom: vi.fn(),
  update: vi.fn(),
  adminEq: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/local-only", () => ({
  getLocalSiteOrigin: () => "http://localhost:3000",
}));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: mocks,
    rpc: mocks.rpc,
    from: mocks.from,
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: mocks.adminClient,
}));

import { deliverEmployeeInvitation } from "./invitation-delivery";

const invitation = {
  id: "invitation-a",
  normalized_email: "fictional-employee@example.test",
  organization_id: "org-a",
  invited_by: "manager-a",
  status: "pending",
  intended_role: "employee",
  expires_at: "2100-01-01T00:00:00Z",
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({ data: { user: { id: "manager-a" } }, error: null });
  mocks.rpc.mockResolvedValue({
    data: [
      {
        authorization_state: "authorized",
        membership_role: "manager",
        organization_id: "org-a",
      },
    ],
    error: null,
  });
  mocks.from.mockReturnValue(mocks);
  mocks.select.mockReturnValue(mocks);
  mocks.eq.mockReturnValue(mocks);
  mocks.single.mockResolvedValue({ data: invitation, error: null });
  mocks.adminClient.mockReturnValue({
    auth: { admin: { inviteUserByEmail: mocks.inviteUserByEmail } },
    from: mocks.adminFrom,
  });
  mocks.inviteUserByEmail.mockResolvedValue({ data: {}, error: null });
  mocks.adminFrom.mockReturnValue({ update: mocks.update });
  mocks.update.mockReturnValue({ eq: mocks.adminEq });
  mocks.adminEq.mockReturnValue({ eq: mocks.adminEq });
});

describe("server-only invitation delivery", () => {
  it("uses database-owned email and caller-scoped invitation", async () => {
    await deliverEmployeeInvitation("invitation-a");
    expect(mocks.rpc).toHaveBeenCalledWith("get_auth_context");
    expect(mocks.eq.mock.calls).toEqual([
      ["id", "invitation-a"],
      ["organization_id", "org-a"],
      ["invited_by", "manager-a"],
      ["status", "pending"],
    ]);
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith(invitation.normalized_email, {
      redirectTo: "http://localhost:3000/auth/callback",
    });
    expect(mocks.adminFrom).not.toHaveBeenCalled();
  });

  it.each([
    {
      authorization_state: "authorized",
      membership_role: "employee",
      organization_id: "org-a",
    },
    {
      authorization_state: "unauthorized",
      membership_role: null,
      organization_id: null,
    },
    {
      authorization_state: "unsupported",
      membership_role: null,
      organization_id: null,
    },
    {
      authorization_state: "authorized",
      membership_role: "manager",
      organization_id: null,
    },
  ])("denies non-manager or unsupported membership context", async (context) => {
    mocks.rpc.mockResolvedValue({ data: [context], error: null });
    await expect(deliverEmployeeInvitation("invitation-a")).rejects.toThrow(
      "Invitation delivery unavailable.",
    );
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it("requires authenticated identity", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(deliverEmployeeInvitation("invitation-a")).rejects.toThrow(
      "Invitation delivery unavailable.",
    );
    expect(mocks.adminClient).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { ...invitation, intended_role: "manager" },
    { ...invitation, expires_at: "2000-01-01T00:00:00Z" },
  ])("denies missing, nonemployee or expired invitation", async (row) => {
    mocks.single.mockResolvedValue({ data: row, error: null });
    await expect(deliverEmployeeInvitation("invitation-a")).rejects.toThrow(
      "Invitation delivery unavailable.",
    );
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
  });

  it.each(["email_exists", "over_email_send_rate_limit", "unexpected_failure"])(
    "conceals %s provider outcome and revokes unsent pending row",
    async (code) => {
      mocks.inviteUserByEmail.mockResolvedValue({
        error: { code, message: "private provider diagnostic" },
      });
      await expect(deliverEmployeeInvitation("invitation-a")).resolves.toBeUndefined();
      expect(mocks.adminFrom).toHaveBeenCalledWith("invitations");
      expect(mocks.update).toHaveBeenCalledWith({
        status: "revoked",
        revoked_at: expect.any(String),
      });
      expect(mocks.adminEq.mock.calls).toEqual([
        ["id", "invitation-a"],
        ["status", "pending"],
      ]);
    },
  );
});
