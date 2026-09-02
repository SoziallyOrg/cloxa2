import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { loadLocalEnvironment, projectRoot } from "./local-auth-config.mjs";

export function containsServerSecret(source, secretKey) {
  if (
    (secretKey && source.includes(secretKey)) ||
    source.includes("SUPABASE_SECRET_KEY") ||
    /\bsb_secret_[A-Za-z0-9_-]{16,}\b/u.test(source)
  ) {
    return true;
  }

  return [
    ...source.matchAll(/\beyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+\b/gu),
  ].some((match) => {
    try {
      return (
        JSON.parse(Buffer.from(match[1], "base64url").toString("utf8")).role ===
        "service_role"
      );
    } catch {
      return false;
    }
  });
}

export async function checkBrowserBundles(secretKey = process.env.SUPABASE_SECRET_KEY) {
  const root = path.join(projectRoot, "apps", "web", ".next", "static");
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = entries.filter(
    (entry) => entry.isFile() && /\.(?:js|map|json)$/u.test(entry.name),
  );

  if (files.length === 0) {
    throw new Error("No production browser bundles found. Run pnpm build first.");
  }

  for (const file of files) {
    const filename = path.join(file.parentPath, file.name);

    if (containsServerSecret(await readFile(filename, "utf8"), secretKey)) {
      throw new Error(
        `Server secret detected in browser bundle ${path.relative(root, filename)}.`,
      );
    }
  }

  return files.length;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  loadLocalEnvironment();
  checkBrowserBundles()
    .then((count) => {
      console.log(
        `Checked ${count} production browser bundle files: no server secret found.`,
      );
    })
    .catch(() => {
      console.error(
        "Browser bundle secret check failed. Inspect locally without printing secret values.",
      );
      process.exitCode = 1;
    });
}
