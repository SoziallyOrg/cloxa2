import { spawnSync } from "node:child_process";
import process from "node:process";

import { checkBrowserBundles } from "./local-auth-bundles.mjs";
import { resolveWebBuildCommand } from "./local-auth-build-command.mjs";
import { loadLocalEnvironment, projectRoot } from "./local-auth-config.mjs";

loadLocalEnvironment();

if (!process.env.npm_execpath) {
  console.error("Run this build through pnpm build.");
  process.exitCode = 1;
} else {
  const { args, command, shell } = resolveWebBuildCommand(process.env.npm_execpath);
  const build = spawnSync(command, args, {
    cwd: projectRoot,
    env: process.env,
    shell,
    stdio: "inherit",
    windowsHide: true,
  });

  if (build.status !== 0 || build.error) {
    process.exitCode = build.status || 1;
  } else {
    try {
      const count = await checkBrowserBundles();
      console.log(
        `Checked ${count} production browser bundle files: no server secret found.`,
      );
    } catch {
      console.error(
        "Browser bundle secret check failed. Inspect locally without printing secret values.",
      );
      process.exitCode = 1;
    }
  }
}
