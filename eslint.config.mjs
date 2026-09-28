import { defineConfig, globalIgnores } from "eslint/config";
import prettier from "eslint-config-prettier/flat";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    settings: {
      next: {
        rootDir: "apps/web",
      },
    },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    rules: {
      // next/image injects inline style attributes, which our nonce CSP blocks.
      // Plain <img> with explicit width/height is the deliberate choice.
      "@next/next/no-img-element": "off",
      "react/jsx-no-literals": [
        "error",
        {
          noStrings: true,
          allowedStrings: [" ", "·", "-", ":", ",", ".", "/", "(", ")"],
          ignoreProps: true,
        },
      ],
    },
  },
  prettier,
  globalIgnores([
    "**/.next/**",
    "**/.pnpm-store/**",
    "**/coverage/**",
    "**/dist/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "**/next-env.d.ts",
    "supabase/.temp/**",
  ]),
]);
