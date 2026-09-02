import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { beforeAll, describe, expect, it } from "vitest";

import {
  getLocalStackStatus,
  loadLocalEnvironment,
  localOnlyFetch,
  requireLocalPassword,
  validateLocalStack,
} from "../../scripts/local-auth-config.mjs";

const requireFromWeb = createRequire(
  new URL("../../apps/web/package.json", import.meta.url),
);
const { createClient } = requireFromWeb("@supabase/supabase-js");

const config = readFileSync(
  new URL("../../supabase/config.toml", import.meta.url),
  "utf8",
);

function readSection(name: string): string {
  const escapedName = name.replaceAll(".", "\\.");
  const match = config.match(
    new RegExp(`\\[${escapedName}\\]([\\s\\S]*?)(?=\\n\\[|$)`, "u"),
  );

  if (!match?.[1]) {
    throw new Error(`Missing Supabase config section: ${name}`);
  }

  return match[1];
}

describe("local Supabase policy", () => {
  beforeAll(() => {
    loadLocalEnvironment();
  });

  it("blocks public signup while keeping the email provider available to admin invitations", () => {
    expect(readSection("auth")).toMatch(/^enable_signup = false$/mu);
    expect(readSection("auth.email")).toMatch(/^enable_signup = true$/mu);
    expect(readSection("auth.sms")).toMatch(/^enable_signup = false$/mu);
  });

  it("rejects an unauthenticated public signup against the local Auth API", async () => {
    const settings = validateLocalStack(process.env, getLocalStackStatus());
    const password = requireLocalPassword(
      process.env.CLOXA_LOCAL_EMPLOYEE_PASSWORD,
      "CLOXA_LOCAL_EMPLOYEE_PASSWORD",
    );
    const admin = createClient(settings.supabaseUrl, settings.secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { fetch: localOnlyFetch },
    });
    const cleanupUserIds = new Set<string>();

    try {
      const response = await fetch(new URL("/auth/v1/signup", settings.supabaseUrl), {
        body: JSON.stringify({
          email: `public-signup.${randomUUID()}@example.test`,
          password,
        }),
        headers: {
          apikey: settings.publishableKey,
          "Content-Type": "application/json",
        },
        method: "POST",
        redirect: "error",
      });
      const body = (await response.json().catch(() => ({}))) as {
        access_token?: unknown;
        id?: unknown;
        user?: { id?: unknown };
      };
      const unexpectedUserId =
        typeof body.user?.id === "string"
          ? body.user.id
          : typeof body.id === "string"
            ? body.id
            : null;
      if (unexpectedUserId) cleanupUserIds.add(unexpectedUserId);

      expect(response.ok).toBe(false);
      expect([400, 403, 422]).toContain(response.status);
      expect(typeof body.access_token).not.toBe("string");
    } finally {
      for (const userId of cleanupUserIds) {
        const { error } = await admin.auth.admin.deleteUser(userId);
        if (error) throw new Error("Local public-signup fixture cleanup failed.");
      }
    }
  });

  it("supports a server-only administrator invitation and removes its Auth fixture", async () => {
    const adminSource = readFileSync(
      new URL("../../apps/web/src/lib/supabase/admin.ts", import.meta.url),
      "utf8",
    );
    expect(adminSource).toMatch(/^import "server-only";/u);

    const settings = validateLocalStack(process.env, getLocalStackStatus());
    const admin = createClient(settings.supabaseUrl, settings.secretKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
      global: { fetch: localOnlyFetch },
    });
    const email = `admin-invite.${randomUUID()}@example.test`;
    let invitedUserId: string | null = null;

    try {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: "http://localhost:3000/auth/callback",
      });
      if (error || !data.user?.id) {
        throw new Error("Local administrator invitation failed.");
      }

      invitedUserId = data.user.id;
      expect(data.user.email?.toLowerCase()).toBe(email);
      expect(data.user.invited_at).toBeTruthy();
    } finally {
      if (invitedUserId) {
        const { error } = await admin.auth.admin.deleteUser(invitedUserId);
        if (error) throw new Error("Local administrator-invitation cleanup failed.");
      }
    }
  });

  it("keeps excluded product services disabled", () => {
    expect(readSection("realtime")).toMatch(/^enabled = false$/mu);
    expect(readSection("storage")).toMatch(/^enabled = false$/mu);
    expect(readSection("edge_runtime")).toMatch(/^enabled = false$/mu);
    expect(readSection("analytics")).toMatch(/^enabled = false$/mu);
  });

  it("requires explicit grants for future public tables", () => {
    expect(readSection("api")).toMatch(/^auto_expose_new_tables = false$/mu);
  });
});
