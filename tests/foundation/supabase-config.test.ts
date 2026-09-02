import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

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
  it("disables all public signup paths", () => {
    expect(readSection("auth")).toMatch(/^enable_signup = false$/mu);
    expect(readSection("auth.email")).toMatch(/^enable_signup = false$/mu);
    expect(readSection("auth.sms")).toMatch(/^enable_signup = false$/mu);
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
