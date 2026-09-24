import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";
import { SERVER_NAME } from "../../identity.js";
import type { McpClient } from "./types.js";

async function readJsonFile(filePath: string): Promise<Record<string, unknown>> {
  let text: string;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  const parsed: unknown = JSON.parse(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`MCP config ${filePath} must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function upsertServerEntry(filePath: string, rootKey: string, entry: unknown): Promise<void> {
  const root = await readJsonFile(filePath);
  const existing = root[rootKey];
  if (existing !== undefined && (!existing || typeof existing !== "object" || Array.isArray(existing))) {
    throw new Error(`MCP config ${filePath} has an invalid ${rootKey} section`);
  }
  const servers = (root[rootKey] ??= {}) as Record<string, unknown>;
  servers[SERVER_NAME] = entry;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(root, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

export interface JsonFileTarget {
  label: string;
  filePath: string;
  rootKey: string;
  buildEntry: (env: Record<string, string>) => Record<string, unknown>;
}

export function jsonFileClient(target: JsonFileTarget): McpClient {
  return {
    label: target.label,
    register: async (env) => {
      try {
        await upsertServerEntry(target.filePath, target.rootKey, target.buildEntry(env));
        return { ok: true, detail: `config written to ${target.filePath}` };
      } catch (error) {
        return { ok: false, detail: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}
