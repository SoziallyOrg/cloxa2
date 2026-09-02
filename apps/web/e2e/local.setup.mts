import { execFileSync } from "node:child_process";
import path from "node:path";

import { projectRoot } from "../../../scripts/local-auth-config.mjs";

export default function setupLocalAuthentication() {
  try {
    execFileSync(
      process.execPath,
      [
        path.join(projectRoot, "scripts", "local-auth-bootstrap.mjs"),
        "--confirm-local-development",
      ],
      {
        cwd: projectRoot,
        env: process.env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch {
    throw new Error(
      "Local E2E manager bootstrap failed. Run pnpm local:bootstrap --confirm-local-development for safe diagnostics.",
    );
  }
}
