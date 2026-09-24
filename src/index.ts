#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadAppConfig } from "./app-config.js";
import { runInitWizard } from "./cli/init.js";
import { createServer } from "./server.js";

async function runServer(): Promise<void> {
  const server = createServer(loadAppConfig());
  await server.connect(new StdioServerTransport());
  console.error("EasyCRM MCP running on stdio");
}

function exitWithError(error: unknown, hint: string): never {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(hint);
  process.exit(1);
}

if (process.argv[2] === "init") {
  await runInitWizard().catch((error: unknown) =>
    exitWithError(error, "Setup did not finish — run the init command again."),
  );
  process.exit(0);
}

await runServer().catch((error: unknown) =>
  exitWithError(error, "Fix the store configuration in your MCP settings and restart the server."),
);
