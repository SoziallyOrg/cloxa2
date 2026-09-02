import { describe, expect, it } from "vitest";

import { resolveWebBuildCommand } from "../scripts/local-auth-build-command.mjs";

const buildArguments = ["--filter", "@cloxa/web", "build"];

describe("build wrapper command resolution", () => {
  it("executes Windows package-manager programs without passing them to Node", () => {
    expect(
      resolveWebBuildCommand("C:\\tools\\pnpm.exe", {
        nodeExecPath: "C:\\node\\node.exe",
        platform: "win32",
      }),
    ).toEqual({
      args: buildArguments,
      command: "C:\\tools\\pnpm.exe",
      shell: false,
    });

    expect(
      resolveWebBuildCommand("C:\\tools\\pnpm.cmd", {
        nodeExecPath: "C:\\node\\node.exe",
        platform: "win32",
      }),
    ).toEqual({
      args: buildArguments,
      command: "C:\\tools\\pnpm.cmd",
      shell: true,
    });
  });

  it.each(["js", "cjs", "mjs"])(
    "uses Node for a .%s JavaScript CLI entry file",
    (extension) => {
      const cliPath = `C:\\tools\\pnpm.${extension}`;

      expect(
        resolveWebBuildCommand(cliPath, {
          nodeExecPath: "C:\\node\\node.exe",
          platform: "win32",
        }),
      ).toEqual({
        args: [cliPath, ...buildArguments],
        command: "C:\\node\\node.exe",
        shell: false,
      });
    },
  );
});
