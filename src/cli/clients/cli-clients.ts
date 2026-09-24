import { spawn } from "node:child_process";
import { SERVER_NAME } from "../../identity.js";
import { LAUNCH_COMMAND, launchArgs } from "./launch.js";
import type { McpClient } from "./types.js";

type CliRunResult = "ok" | "cliMissing" | "failed";

function runCli(command: string, args: string[], stderr: "inherit" | "ignore"): Promise<CliRunResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", stderr] });
    child.on("error", () => resolve("cliMissing"));
    child.on("exit", (code) => resolve(code === 0 ? "ok" : "failed"));
  });
}

interface CliTarget {
  label: string;
  command: string;
  envFlag: string;
  scopeArgs: string[];
}

export function cliClient(target: CliTarget): McpClient {
  return {
    label: target.label,
    register: async (env) => {
      const envArgs = Object.entries(env).flatMap(([name, value]) => [
        target.envFlag,
        `${name}=${value}`,
      ]);
      const result = await runCli(
        target.command,
        ["mcp", "add", ...target.scopeArgs, SERVER_NAME, ...envArgs, "--", LAUNCH_COMMAND, ...launchArgs()],
        "inherit",
      );
      if (result === "ok") return { ok: true, detail: `registered via ${target.command} mcp add` };
      return {
        ok: false,
        detail:
          result === "cliMissing"
            ? `${target.command} CLI not found on PATH`
            : `${target.command} mcp add failed; any existing MCP entry was preserved`,
      };
    },
  };
}
