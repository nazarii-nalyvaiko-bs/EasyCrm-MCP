import assert from "node:assert/strict";
import { test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ShopifyUserError } from "../dist/shopify/errors.js";
import { createCustomer, deleteCustomer, listCustomers, updateCustomer } from "../dist/shopify/operations/customers.js";
import { createProduct, deleteProduct, listProducts, updateProduct } from "../dist/shopify/operations/products.js";
import { registerShopifyCatalogCustomerTools } from "../dist/tools/shopify-catalog-customers.js";
import { listInventoryLocations, listProductVariants, listVariantInventory, setInventoryAvailable, updateVariantPrice } from "../dist/shopify/operations/variants.js";

function stub(response) {
  const calls = [];
  return {
    calls,
    async query(document, variables) {
      calls.push({ document, variables });
      return response;
    },
  };
}

test("product list forwards search and cursor and returns pagination", async () => {
  const page = { nodes: [], pageInfo: { hasNextPage: true, endCursor: "next" } };
  const client = stub({ products: page });
  assert.deepEqual(await listProducts(client, { first: 25, after: "previous", query: "title:shirt" }), page);
  assert.match(client.calls[0].document, /products\(first: \$first, after: \$after, query: \$query\)/);
  assert.deepEqual(client.calls[0].variables, { first: 25, after: "previous", query: "title:shirt" });
});

test("product writes use separate create and update inputs", async () => {
  const product = { id: "gid://shopify/Product/1", title: "Shirt" };
  const created = stub({ productCreate: { product, userErrors: [] } });
  assert.deepEqual(await createProduct(created, { title: "Shirt", status: "DRAFT" }), product);
  assert.deepEqual(created.calls[0].variables, { product: { title: "Shirt", status: "DRAFT" } });
  assert.match(created.calls[0].document, /ProductCreateInput!/);

  const updated = stub({ productUpdate: { product, userErrors: [] } });
  assert.deepEqual(await updateProduct(updated, product.id, { title: "Shirt", tags: [] }), product);
  assert.deepEqual(updated.calls[0].variables, { product: { id: product.id, title: "Shirt", tags: [] } });
  assert.match(updated.calls[0].document, /ProductUpdateInput!/);
});

test("product mutation errors cannot be mistaken for success", async () => {
  const errors = [{ field: ["title"], message: "Title is invalid" }];
  const client = stub({ productCreate: { product: null, userErrors: errors } });
  await assert.rejects(createProduct(client, { title: "Bad" }), ShopifyUserError);

  const missing = stub({ productDelete: { deletedProductId: null, userErrors: [] } });
  await assert.rejects(deleteProduct(missing, "gid://shopify/Product/1"), /returned no data/);
});

test("product deletion runs synchronously and confirms deleted GID", async () => {
  const id = "gid://shopify/Product/1";
  const client = stub({ productDelete: { deletedProductId: id, userErrors: [] } });
  assert.deepEqual(await deleteProduct(client, id), { deletedProductId: id });
  assert.match(client.calls[0].document, /synchronous: true/);
  const mismatch = stub({ productDelete: { deletedProductId: "gid://shopify/Product/2", userErrors: [] } });
  await assert.rejects(deleteProduct(mismatch, id), /did not confirm deletion/);
});

test("customer list forwards search and cursor", async () => {
  const page = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };
  const client = stub({ customers: page });
  assert.deepEqual(await listCustomers(client, { first: 10, query: "email:test@example.com" }), page);
  assert.deepEqual(client.calls[0].variables, { first: 10, query: "email:test@example.com" });
});

test("customer writes include identity only on update and handle deletion errors", async () => {
  const customer = { id: "gid://shopify/Customer/1", email: "test@example.com" };
  const created = stub({ customerCreate: { customer, userErrors: [] } });
  assert.deepEqual(await createCustomer(created, { email: "test@example.com" }), customer);
  assert.deepEqual(created.calls[0].variables, { input: { email: "test@example.com" } });

  const updated = stub({ customerUpdate: { customer, userErrors: [] } });
  assert.deepEqual(await updateCustomer(updated, customer.id, { note: "VIP" }), customer);
  assert.deepEqual(updated.calls[0].variables, { input: { id: customer.id, note: "VIP" } });

  const denied = stub({ customerDelete: { deletedCustomerId: null, userErrors: [{ field: ["id"], message: "Customer has orders" }] } });
  await assert.rejects(deleteCustomer(denied, customer.id), /Customer has orders/);
});

test("variant price mutation updates only the requested variant", async () => {
  const variantId = "gid://shopify/ProductVariant/1";
  const updated = { id: variantId, price: "19.99", compareAtPrice: null };
  const client = stub({ productVariantsBulkUpdate: { productVariants: [updated], userErrors: [] } });
  assert.deepEqual(await updateVariantPrice(client, {
    productId: "gid://shopify/Product/1", variantId, price: "19.99", compareAtPrice: null,
  }), updated);
  assert.deepEqual(client.calls[0].variables.variants, [{ id: variantId, price: "19.99", compareAtPrice: null }]);

  const missing = stub({ productVariantsBulkUpdate: { productVariants: [], userErrors: [] } });
  await assert.rejects(updateVariantPrice(missing, {
    productId: "gid://shopify/Product/1", variantId, price: "19.99",
  }), /did not return the requested variant/);
});

test("inventory set uses compare-and-set and a caller-supplied idempotency key", async () => {
  const input = {
    inventoryItemId: "gid://shopify/InventoryItem/1",
    locationId: "gid://shopify/Location/2",
    quantity: 9,
    compareQuantity: 5,
    idempotencyKey: "52c2f3ca-2dad-4fd0-b715-de32d6d09e57",
  };
  const changes = [{ name: "available", delta: 4, quantityAfterChange: 9 }];
  const client = stub({ inventorySetQuantities: { inventoryAdjustmentGroup: { changes }, userErrors: [] } });
  assert.deepEqual(await setInventoryAvailable(client, input), { idempotencyKey: input.idempotencyKey, changes });
  assert.match(client.calls[0].document, /@idempotent\(key: \$idempotencyKey\)/);
  assert.deepEqual(client.calls[0].variables, {
    input: {
      name: "available", reason: "correction",
      quantities: [{
        inventoryItemId: input.inventoryItemId,
        locationId: input.locationId,
        quantity: 9,
        compareQuantity: 5,
      }],
    },
    idempotencyKey: input.idempotencyKey,
  });

  const conflict = stub({ inventorySetQuantities: {
    inventoryAdjustmentGroup: null,
    userErrors: [{ field: ["compareQuantity"], message: "Quantity changed" }],
  } });
  await assert.rejects(setInventoryAvailable(conflict, input), /Quantity changed/);
});

test("variant and location reads preserve cursor information", async () => {
  const pageInfo = { hasNextPage: true, endCursor: "next" };
  const variants = { nodes: [], pageInfo };
  const variantClient = stub({ product: { variants } });
  assert.deepEqual(await listProductVariants(variantClient, "gid://shopify/Product/1", 20), variants);

  const levels = { nodes: [], pageInfo };
  const inventoryClient = stub({ productVariant: { inventoryItem: {
    id: "gid://shopify/InventoryItem/1", tracked: true, inventoryLevels: levels,
  } } });
  assert.deepEqual(await listVariantInventory(inventoryClient, "gid://shopify/ProductVariant/1", 20), {
    inventoryItemId: "gid://shopify/InventoryItem/1", tracked: true, levels,
  });

  const locations = { nodes: [], pageInfo };
  const locationClient = stub({ locations });
  assert.deepEqual(await listInventoryLocations(locationClient, 20, "previous"), locations);
  assert.deepEqual(locationClient.calls[0].variables, { first: 20, after: "previous" });
});

test("registers fifteen tools and rejects empty updates before calling Shopify", async () => {
  const api = stub({});
  const server = new McpServer({ name: "test", version: "1.0.0" });
  registerShopifyCatalogCustomerTools(server, api);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 15);
    const response = await client.callTool({ name: "shopify_product_update", arguments: { id: "gid://shopify/Product/1" } });
    assert.equal(response.isError, true);
    assert.match(response.content[0].text, /at least one field/);
    assert.equal(api.calls.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});
