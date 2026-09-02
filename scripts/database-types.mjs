import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { format, resolveConfig } from "prettier";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(
  projectRoot,
  "packages",
  "database",
  "src",
  "database.types.ts",
);
const outputLabel = path.relative(projectRoot, outputPath).replaceAll(path.sep, "/");
const supabaseCliPath = path.join(
  projectRoot,
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
);

async function generateTypes() {
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      supabaseCliPath,
      "gen",
      "types",
      "--local",
      "--lang",
      "typescript",
      "--schema",
      "public",
    ],
    {
      cwd: projectRoot,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    },
  );
  const prettierConfig = await resolveConfig(outputPath);

  return format(stdout, {
    ...prettierConfig,
    filepath: outputPath,
  });
}

async function main() {
  const mode = process.argv[2];

  if (mode !== "--write" && mode !== "--check") {
    throw new Error("Usage: database-types.mjs --write|--check");
  }

  const generatedTypes = await generateTypes();

  if (mode === "--write") {
    await writeFile(outputPath, generatedTypes, "utf8");
    console.log(`Generated ${outputLabel}`);
    return;
  }

  let storedTypes;

  try {
    storedTypes = await readFile(outputPath, "utf8");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      throw new Error(`${outputLabel} is missing. Run \`pnpm supabase:types\`.`);
    }

    throw error;
  }

  if (storedTypes.replaceAll("\r\n", "\n") !== generatedTypes) {
    throw new Error(
      `${outputLabel} is stale. Run \`pnpm supabase:types\` and commit the result.`,
    );
  }

  console.log(`${outputLabel} is current.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
