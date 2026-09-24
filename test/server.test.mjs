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
    assert.ok(names.includes("shopify_product_create"));
    assert.ok(names.includes("shopify_customer_delete"));
    assert.ok(names.includes("shopify_order_delete"));
    assert.ok(names.includes("shopify_order_summary"));
    assert.ok(names.includes("shopify_discount_code_create"));
    assert.ok(names.includes("horoshop_product_list"));
    assert.ok(names.includes("horoshop_product_update"));
    assert.ok(names.includes("horoshop_order_summary"));
    assert.ok(names.includes("horoshop_order_update"));
    assert.ok(names.includes("horoshop_category_list"));
    assert.ok(names.includes("horoshop_customer_upsert"));
    assert.equal(new Set(names).size, names.length);
    assert.ok(names.every((name) => name.startsWith("shopify_") || name.startsWith("horoshop_")));
  } finally {
    await client.close();
    await server.close();
  }
});

test("registers only the configured provider's tools", async () => {
  const server = createServer({ horoshop: {
    baseUrl: "https://shop.example.com", login: "api-user", password: "test-password",
  } });
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    assert.ok(tools.length > 0);
    assert.ok(tools.every((tool) => tool.name.startsWith("horoshop_")));
  } finally {
    await client.close();
    await server.close();
  }
});
