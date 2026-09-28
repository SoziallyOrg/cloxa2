import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ACTION_DESCRIPTIONS, actionCategory, describeAction } from "./describe";

// apps/web/src/lib/audit -> repo root.
const MIGRATIONS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "migrations",
);

/**
 * Every `write_audit`/`write_kiosk_audit` call's action argument (the 2nd
 * argument, never containing a comma itself). Handles the one dynamic case
 * (`'correction_request.' || p_decision`) by resolving `p_decision` from its
 * `not in (...)` guard in the same file.
 */
function extractActions(sql: string): string[] {
  const actions: string[] = [];
  const callRe = /(?:write_audit|write_kiosk_audit)\s*\(\s*[^,]+,\s*([^,]+?)\s*,/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(sql)) !== null) {
    const expression = match[1]!.trim();

    const literal = /^'([a-z][a-z_]*(?:\.[a-z_]+)*)'$/.exec(expression);
    if (literal) {
      actions.push(literal[1]!);
      continue;
    }

    const dynamic = /^'([a-z][a-z_]*\.)'\s*\|\|\s*(\w+)$/.exec(expression);
    if (dynamic) {
      const [, prefix, variable] = dynamic;
      const guard = new RegExp(`${variable}\\s+not in \\(([^)]+)\\)`).exec(sql);
      if (!guard) {
        throw new Error(`Cannot resolve dynamic action for ${variable} in migrations`);
      }
      for (const valueMatch of guard[1]!.matchAll(/'([a-z_]+)'/g)) {
        actions.push(`${prefix}${valueMatch[1]}`);
      }
    }
    // Anything else (e.g. the write_audit/write_kiosk_audit function
    // definitions themselves) isn't a call with a literal action: skip it.
  }
  return actions;
}

function allMigrationActions(): Set<string> {
  const files = readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"));
  const actions = new Set<string>();
  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    for (const action of extractActions(sql)) actions.add(action);
  }
  return actions;
}

describe("ACTION_DESCRIPTIONS", () => {
  it("covers every action written by the migrations", () => {
    const found = allMigrationActions();
    // Guards against a broken extractor silently finding nothing.
    expect(found.size).toBeGreaterThan(10);
    const missing = [...found].filter((action) => !(action in ACTION_DESCRIPTIONS));
    expect(missing).toEqual([]);
  });

  it("has no stale entries for actions no migration writes anymore", () => {
    const found = allMigrationActions();
    const stale = Object.keys(ACTION_DESCRIPTIONS).filter(
      (action) => !found.has(action),
    );
    expect(stale).toEqual([]);
  });
});

describe("describeAction", () => {
  it("returns the mapped key for a known action", () => {
    expect(describeAction("kiosk.paired")).toBe("audit.action.kioskPaired");
  });

  it("falls back to the unknown-action key", () => {
    expect(describeAction("something.unmapped")).toBe("audit.action.unknown");
  });
});

describe("actionCategory", () => {
  it("takes the part before the first dot", () => {
    expect(actionCategory("kiosk.pin_failed")).toBe("kiosk");
    expect(actionCategory("correction_request.approved")).toBe("correction_request");
  });
});
