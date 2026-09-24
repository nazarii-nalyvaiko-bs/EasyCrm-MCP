import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { jsonFileClient } from "../dist/cli/clients/json-clients.js";

test("writes a new MCP config with private permissions", async () => {
  const directory = await mkdtemp(join(tmpdir(), "easycrm-mcp-"));
  const filePath = join(directory, "mcp.json");
  try {
    const client = jsonFileClient({
      label: "test",
      filePath,
      rootKey: "mcpServers",
      buildEntry: (env) => ({ command: "npx", args: ["-y", "easycrm-mcp"], env }),
    });
    assert.equal((await client.register({ HOROSHOP_PASSWORD: "test-secret" })).ok, true);
    assert.equal((await stat(filePath)).mode & 0o777, 0o600);
    const saved = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(saved.mcpServers.easycrm.env.HOROSHOP_PASSWORD, "test-secret");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("does not replace an unreadable config target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "easycrm-mcp-"));
  const filePath = join(directory, "mcp.json");
  try {
    await mkdir(filePath);
    const client = jsonFileClient({
      label: "test",
      filePath,
      rootKey: "mcpServers",
      buildEntry: () => ({}),
    });
    assert.equal((await client.register({})).ok, false);
    assert.equal((await stat(filePath)).isDirectory(), true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
