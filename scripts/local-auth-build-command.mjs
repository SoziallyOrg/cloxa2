import { extname } from "node:path";
import process from "node:process";

const buildArguments = ["--filter", "@cloxa/web", "build"];
const javaScriptExtensions = new Set([".cjs", ".js", ".mjs"]);
const windowsCommandExtensions = new Set([".bat", ".cmd"]);

export function resolveWebBuildCommand(
  npmExecPath,
  { nodeExecPath = process.execPath, platform = process.platform } = {},
) {
  const extension = extname(npmExecPath).toLowerCase();

  if (javaScriptExtensions.has(extension)) {
    return {
      args: [npmExecPath, ...buildArguments],
      command: nodeExecPath,
      shell: false,
    };
  }

  return {
    args: [...buildArguments],
    command: npmExecPath,
    shell: platform === "win32" && windowsCommandExtensions.has(extension),
  };
}
