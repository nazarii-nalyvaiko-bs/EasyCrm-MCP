import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerShopifyThemeManagementTools } from "../dist/tools/shopify-theme-management.js";
import {
  createUnpublishedTheme,
  duplicateUnpublishedTheme,
  getActiveTheme,
  publishTheme,
} from "../dist/shopify/operations/theme-management.js";

const main = { id: "gid://shopify/OnlineStoreTheme/1", name: "Live", role: "MAIN", processing: false, processingFailed: false };
const draft = { id: "gid://shopify/OnlineStoreTheme/2", name: "Draft", role: "UNPUBLISHED", processing: true, processingFailed: false };

test("reads exactly one MAIN theme", async () => {
  const client = { async query(query) {
    assert.match(query, /roles: \[MAIN\]/);
    return { themes: { nodes: [main] } };
  } };
  assert.deepEqual(await getActiveTheme(client), main);
});

test("imports a ZIP explicitly as UNPUBLISHED", async () => {
  const client = { async query(query, variables) {
    assert.match(query, /role: UNPUBLISHED/);
    assert.deepEqual(variables, { source: "https://example.com/theme.zip", name: "Draft" });
    return { themeCreate: { theme: draft, userErrors: [] } };
  } };
  assert.deepEqual(await createUnpublishedTheme(client, "https://example.com/theme.zip", "Draft"), draft);
});

test("duplicates a theme and checks its returned role", async () => {
  const client = { async query(_query, variables) {
    assert.deepEqual(variables, { id: main.id, name: "Copy" });
    return { themeDuplicate: { newTheme: draft, userErrors: [] } };
  } };
  assert.deepEqual(await duplicateUnpublishedTheme(client, main.id, "Copy"), draft);
});

test("rejects an unexpected published role from duplicate", async () => {
  const client = { async query() {
    return { themeDuplicate: { newTheme: main, userErrors: [] } };
  } };
  await assert.rejects(duplicateUnpublishedTheme(client, main.id), /unexpected role MAIN/);
});

test("publish checks the current MAIN theme immediately before mutation", async () => {
  const calls = [];
  const client = { async query(query, variables) {
    calls.push(query);
    if (calls.length === 1) return { themes: { nodes: [main] } };
    assert.deepEqual(variables, { id: draft.id });
    return { themePublish: { theme: { ...draft, role: "MAIN" }, userErrors: [] } };
  } };
  assert.equal((await publishTheme(client, draft.id, main.id)).role, "MAIN");
  assert.equal(calls.length, 2);
});

test("publish stops if the active theme changed", async () => {
  let mutationCalled = false;
  const client = { async query() {
    if (mutationCalled) throw new Error("mutation called");
    mutationCalled = true;
    return { themes: { nodes: [{ ...main, id: "gid://shopify/OnlineStoreTheme/99" }] } };
  } };
  await assert.rejects(publishTheme(client, draft.id, main.id), /Active theme changed/);
});

test("publish requires Shopify confirmation for the requested theme", async () => {
  const client = { async query(query) {
    if (query.includes("query ActiveTheme")) return { themes: { nodes: [main] } };
    return { themePublish: { theme: { ...draft, role: "UNPUBLISHED" }, userErrors: [] } };
  } };
  await assert.rejects(publishTheme(client, draft.id, main.id), /did not confirm/);
});

test("publish tool requires an explicit confirmation flag", async () => {
  const server = new McpServer({ name: "test", version: "1" });
  const client = new Client({ name: "test-client", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  registerShopifyThemeManagementTools(server, { async query() {
    throw new Error("Shopify must not be called without confirmation");
  } });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.callTool({ name: "shopify_theme_publish", arguments: {
      themeId: draft.id,
      expectedCurrentMainThemeId: main.id,
    } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /confirmPublish/);
  } finally {
    await client.close();
    await server.close();
  }
});
