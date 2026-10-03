import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  // tsconfig says `jsx: preserve` (Next compiles JSX); tests need it transformed.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
