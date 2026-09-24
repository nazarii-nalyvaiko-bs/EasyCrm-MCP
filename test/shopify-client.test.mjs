import assert from "node:assert/strict";
import { test } from "node:test";
import { ShopifyClient } from "../dist/shopify/client.js";

const config = {
  storeDomain: "example.myshopify.com",
  auth: { mode: "accessToken", accessToken: "test-token" },
};

test("sends GraphQL requests to the supported Admin API version", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    return Response.json({ data: { shop: { name: "Example" } } });
  });

  const tokenProvider = {
    canRefresh: false,
    getToken: async () => "test-token",
    invalidate: () => {},
  };
  const client = new ShopifyClient(config, tokenProvider);

  assert.deepEqual(await client.query("query { shop { name } }"), {
    shop: { name: "Example" },
  });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://example.myshopify.com/admin/api/2026-07/graphql.json");
  assert.equal(requests[0].options.headers["X-Shopify-Access-Token"], "test-token");
});

test("refreshes an expired token once after an unauthorized response", async (t) => {
  let requestCount = 0;
  let invalidations = 0;
  t.mock.method(globalThis, "fetch", async () => {
    requestCount += 1;
    return requestCount === 1
      ? new Response("Unauthorized", { status: 401 })
      : Response.json({ data: { shop: { name: "Example" } } });
  });

  const tokenProvider = {
    canRefresh: true,
    getToken: async () => "test-token",
    invalidate: () => { invalidations += 1; },
  };
  const client = new ShopifyClient(config, tokenProvider);

  assert.deepEqual(await client.query("query { shop { name } }"), {
    shop: { name: "Example" },
  });
  assert.equal(requestCount, 2);
  assert.equal(invalidations, 1);
});
