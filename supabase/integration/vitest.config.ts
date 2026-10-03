import { defineConfig } from "vitest/config";

// Needs a running local Supabase stack (Docker), so it is not part of the root
// `pnpm test` projects. Run with `pnpm db:integration`.
export default defineConfig({
  test: {
    name: "db-integration",
    environment: "node",
    include: ["*.test.ts"],
    // Resolves and checks the database once; an unreachable DB fails the run.
    globalSetup: ["./global-setup.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
