import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../dist/server.js";

test("registers platform-specific tools for both configured stores", async () => {
  const server = createServer({
    shopify: {
      storeDomain: "example.myshopify.com",
      auth: { mode: "accessToken", accessToken: "test-token" },
    },
    horoshop: {
      baseUrl: "https://shop.example.com",
      login: "api-user",
      password: "test-password",
    },
  });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes("shopify_get_info"));
    assert.ok(names.includes("shopify_theme_update_file"));
    assert.ok(names.includes("horoshop_product_list"));
    assert.equal(names.length, 10);
  } finally {
    await client.close();
    await server.close();
  }
});
