import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { containsServerSecret } from "../scripts/local-auth-bundles.mjs";

const sourceRoot = fileURLToPath(new URL("../apps/web/src", import.meta.url));

describe("server key browser boundary", () => {
  it("detects exact configured secrets without depending on key format", () => {
    expect(
      containsServerSecret(
        "const secret = 'fictional-secret-value'",
        "fictional-secret-value",
      ),
    ).toBe(true);
    expect(
      containsServerSecret(
        "const publicKey = 'publishable-value'",
        "fictional-secret-value",
      ),
    ).toBe(false);
  });

  it("detects secret environment references and current secret keys", () => {
    expect(containsServerSecret("process.env.SUPABASE_SECRET_KEY")).toBe(true);
    expect(containsServerSecret("sb_secret_abcdefghijklmnopqrstuvwxyz")).toBe(true);
    expect(containsServerSecret("sb_publishable_abcdefghijklmnopqrstuvwxyz")).toBe(
      false,
    );
  });

  it("detects legacy service-role JWTs but permits anonymous JWTs", () => {
    const token = (role: string) =>
      `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString("base64url")}.synthetic_signature`;
    expect(containsServerSecret(token("service_role"))).toBe(true);
    expect(containsServerSecret(token("anon"))).toBe(false);
  });

  it("keeps admin and server environment modules behind server-only", () => {
    for (const relative of ["lib/env/server.ts", "lib/supabase/admin.ts"]) {
      expect(readFileSync(path.join(sourceRoot, relative), "utf8")).toMatch(
        /^import "server-only";/u,
      );
    }
  });

  it("client import graphs cannot reach secrets or server-only modules", () => {
    const entries = readdirSync(sourceRoot, { recursive: true, withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name));
    const clientEntries = files.filter((filename) =>
      /^['"]use client['"];?/u.test(readFileSync(filename, "utf8").trimStart()),
    );
    expect(clientEntries.length).toBeGreaterThan(0);
    const visited = new Set<string>();

    function inspect(filename: string) {
      if (visited.has(filename)) return;
      visited.add(filename);
      const source = readFileSync(filename, "utf8");
      // Next.js replaces imports from explicit action modules with server references.
      if (/^['"]use server['"];?/u.test(source.trimStart())) return;
      expect(
        source.includes('import "server-only"'),
        path.relative(sourceRoot, filename),
      ).toBe(false);
      expect(
        source.includes("SUPABASE_SECRET_KEY"),
        path.relative(sourceRoot, filename),
      ).toBe(false);

      for (const match of source.matchAll(
        /(?:from\s+|import\s*\()['"]([^'"]+)['"]/gu,
      )) {
        const reference = match[1]!;
        const base = reference.startsWith("@/")
          ? path.join(sourceRoot, reference.slice(2))
          : reference.startsWith(".")
            ? path.resolve(path.dirname(filename), reference)
            : null;
        if (!base) continue;
        const target = [
          base,
          `${base}.ts`,
          `${base}.tsx`,
          path.join(base, "index.ts"),
          path.join(base, "index.tsx"),
        ].find((candidate) => existsSync(candidate) && /\.tsx?$/u.test(candidate));
        if (target) inspect(target);
      }
    }

    clientEntries.forEach(inspect);
  });
});

describe("local browser journey privacy", () => {
  it("disables trace, screenshot, video, and form-value failure snapshots", () => {
    const config = readFileSync(
      new URL("../playwright.config.ts", import.meta.url),
      "utf8",
    );
    for (const setting of [
      'trace: "off"',
      'screenshot: "off"',
      'video: "off"',
      'preserveOutput: "never"',
      'process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1"',
    ]) {
      expect(config.includes(setting)).toBe(true);
    }
  });

  it("blocks non-local HTTP requests in both manager and separate employee contexts", () => {
    const journey = readFileSync(
      new URL("../apps/web/e2e/local-auth.spec.mts", import.meta.url),
      "utf8",
    );
    expect(journey.includes("await blockExternalRequests(context)")).toBe(true);
    expect(journey.includes("await blockExternalRequests(employeeContext)")).toBe(true);
    expect(journey.includes('await route.abort("blockedbyclient")')).toBe(true);
  });
});
