import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ShopifyUserError } from "../dist/shopify/errors.js";
import { addProductImages, createDraftProductWithImages, listProductMedia } from "../dist/shopify/operations/product-media.js";
import { registerShopifyProductMediaTools } from "../dist/tools/shopify-product-media.js";

const productId = "gid://shopify/Product/1";
const image = { url: "https://example.com/shirt.jpg", alt: "Blue shirt" };
const media = { id: "gid://shopify/MediaImage/2", alt: "Blue shirt", status: "PROCESSING", mediaContentType: "IMAGE", mediaErrors: [], image: null };
const page = { nodes: [media], pageInfo: { hasNextPage: false, endCursor: null } };

function stub(...responses) {
  const calls = [];
  return {
    calls,
    async query(document, variables) {
      calls.push({ document, variables });
      const response = responses.shift();
      if (response instanceof Error) throw response;
      if (!response) throw new Error("Unexpected Shopify query");
      return response;
    },
  };
}

test("create draft with image submits media and preserves asynchronous status", async () => {
  const product = { id: productId, title: "Shirt", status: "DRAFT", media: page, variants: { nodes: [{ id: "gid://shopify/ProductVariant/3", price: "0.00" }] } };
  const client = stub({ productCreate: { product, userErrors: [] } });
  const outcome = await createDraftProductWithImages(client, { title: "Shirt", images: [image] });
  assert.equal(outcome.product.id, productId);
  assert.equal(outcome.product.media.nodes[0].status, "PROCESSING");
  assert.equal(outcome.processing, "async");
  assert.deepEqual(outcome.priceUpdate, { status: "not_requested" });
  assert.deepEqual(client.calls[0].variables, {
    product: { title: "Shirt", status: "DRAFT" },
    media: [{ originalSource: image.url, mediaContentType: "IMAGE", alt: image.alt }],
  });
  assert.match(client.calls[0].document, /productCreate\(product: \$product, media: \$media\)/);
});

test("price failure reports the created draft for safe follow-up", async () => {
  const product = { id: productId, title: "Shirt", status: "DRAFT", media: page, variants: { nodes: [{ id: "gid://shopify/ProductVariant/3", price: "0.00" }] } };
  const client = stub(
    { productCreate: { product, userErrors: [] } },
    { productVariantsBulkUpdate: { productVariants: [], userErrors: [{ field: ["price"], message: "Price rejected" }] } },
  );
  const outcome = await createDraftProductWithImages(client, { title: "Shirt", images: [image], price: "19.99" });
  assert.equal(outcome.product.id, productId);
  assert.equal(outcome.priceUpdate.status, "failed");
  assert.match(outcome.priceUpdate.message, /Price rejected/);
  assert.equal(client.calls.length, 2);
});

test("initial price success is confirmed separately from image processing", async () => {
  const variantId = "gid://shopify/ProductVariant/3";
  const product = { id: productId, title: "Shirt", status: "DRAFT", media: page, variants: { nodes: [{ id: variantId, price: "0.00" }] } };
  const client = stub(
    { productCreate: { product, userErrors: [] } },
    { productVariantsBulkUpdate: { productVariants: [{ id: variantId, price: "19.99", compareAtPrice: null }], userErrors: [] } },
  );
  const outcome = await createDraftProductWithImages(client, { title: "Shirt", images: [image], price: "19.99" });
  assert.deepEqual(outcome.priceUpdate, { status: "applied", price: "19.99" });
  assert.equal(outcome.processing, "async");
  assert.deepEqual(client.calls[1].variables.variants, [{ id: variantId, price: "19.99" }]);
});

test("creation error retains product ID when Shopify returned a partial product", async () => {
  const product = { id: productId, title: "Shirt", status: "DRAFT", media: page, variants: { nodes: [] } };
  const client = stub({ productCreate: { product, userErrors: [{ field: ["media"], message: "Image rejected" }] } });
  await assert.rejects(createDraftProductWithImages(client, { title: "Shirt", images: [image] }), /Product\/1.*Image rejected.*before retrying/);
});

test("compare-at price without price is rejected before product creation", async () => {
  const client = stub();
  await assert.rejects(createDraftProductWithImages(client, {
    title: "Shirt", images: [image], compareAtPrice: "29.99",
  }), /Provide price/);
  assert.equal(client.calls.length, 0);
});

test("image submission checks user errors and product identity", async () => {
  const accepted = stub({ productUpdate: { product: { id: productId }, userErrors: [] } });
  assert.deepEqual(await addProductImages(accepted, productId, [image]), {
    productId, submittedImageCount: 1, processing: "async",
  });
  assert.deepEqual(accepted.calls[0].variables.media, [{ originalSource: image.url, mediaContentType: "IMAGE", alt: image.alt }]);
  const rejected = stub({ productUpdate: { product: null, userErrors: [{ field: ["media"], message: "Bad image" }] } });
  await assert.rejects(addProductImages(rejected, productId, [image]), ShopifyUserError);
  const mismatched = stub({ productUpdate: { product: { id: "gid://shopify/Product/2" }, userErrors: [] } });
  await assert.rejects(addProductImages(mismatched, productId, [image]), /different product ID/);
});

test("media list exposes processing failures and pagination", async () => {
  const failedPage = { nodes: [{ ...media, status: "FAILED", mediaErrors: [{ code: "IMAGE_DOWNLOAD_FAILURE", message: "Download failed" }] }], pageInfo: { hasNextPage: true, endCursor: "cursor" } };
  const client = stub({ product: { media: failedPage } });
  assert.deepEqual(await listProductMedia(client, productId, 10, "old"), failedPage);
  assert.deepEqual(client.calls[0].variables, { productId, first: 10, after: "old" });
  assert.match(client.calls[0].document, /mediaErrors \{ code message \}/);
});

test("MCP tool validates HTTPS image source before writing", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const api = stub();
  registerShopifyProductMediaTools(server, api);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      "shopify_product_create_draft_with_images", "shopify_product_image_add", "shopify_product_image_add_local", "shopify_product_media_list",
    ].sort());
    const response = await client.callTool({
      name: "shopify_product_create_draft_with_images",
      arguments: { title: "Shirt", images: [{ url: "http://example.com/shirt.jpg" }] },
    });
    assert.equal(response.isError, true);
    assert.equal(api.calls.length, 0);
  } finally {
    await client.close();
    await server.close();
  }
});

test("MCP draft create marks a failed second step as an error with the created product ID", async () => {
  const server = new McpServer({ name: "test", version: "1.0.0" });
  const product = { id: productId, title: "Shirt", status: "DRAFT", media: page, variants: { nodes: [] } };
  const api = stub({ productCreate: { product, userErrors: [] } });
  registerShopifyProductMediaTools(server, api);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const response = await client.callTool({
      name: "shopify_product_create_draft_with_images",
      arguments: { title: "Shirt", images: [image], price: "19.99" },
    });
    assert.equal(response.isError, true);
    const outcome = JSON.parse(response.content[0].text);
    assert.equal(outcome.product.id, productId);
    assert.equal(outcome.priceUpdate.status, "failed");
  } finally {
    await client.close();
    await server.close();
  }
});
