import assert from "node:assert/strict";
import { test } from "node:test";
import { HoroshopClient } from "../dist/horoshop/client.js";
import { normalizeHoroshopUrl } from "../dist/horoshop/config.js";
import { listProducts } from "../dist/horoshop/products.js";

const config = {
  baseUrl: "https://shop.example.com",
  login: "api-user",
  password: "test-password",
};

test("Horoshop URL accepts only an HTTPS store origin", () => {
  assert.equal(normalizeHoroshopUrl("https://shop.example.com/"), config.baseUrl);
  assert.throws(() => normalizeHoroshopUrl("http://shop.example.com"));
  assert.throws(() => normalizeHoroshopUrl("https://shop.example.com/api/auth/"));
  assert.throws(() => normalizeHoroshopUrl("https://user:pass@shop.example.com"));
});

test("reads Horoshop products with a cached API token", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return Response.json(url.endsWith("/api/auth/")
      ? { status: "OK", response: { token: "test-token" } }
      : { status: "OK", response: { products: [{ article: "SKU-1", price: 42 }] } });
  });

  const client = new HoroshopClient(config);
  const search = { article: "SKU-1", offset: 0, limit: 20 };
  assert.deepEqual(await listProducts(client, search), [{ article: "SKU-1", price: 42 }]);
  assert.deepEqual(await listProducts(client, search), [{ article: "SKU-1", price: 42 }]);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, "https://shop.example.com/api/auth/");
  assert.deepEqual(requests[0].body, { login: "api-user", password: "test-password" });
  assert.equal(requests[1].url, "https://shop.example.com/api/catalog/export/");
  assert.deepEqual(requests[1].body, {
    offset: 0, limit: 20, expr: { article: "SKU-1" }, token: "test-token",
  });
  assert.equal("password" in requests[1].body, false);
});

test("renews a Horoshop token after an unauthorized catalog response", async (t) => {
  let authCount = 0;
  let catalogCount = 0;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/api/auth/")) {
      authCount += 1;
      return Response.json({ status: "OK", response: { token: `token-${authCount}` } });
    }
    catalogCount += 1;
    return Response.json(catalogCount === 1
      ? { status: "UNAUTHORIZED" }
      : { status: "EMPTY" });
  });

  assert.deepEqual(await listProducts(new HoroshopClient(config), { offset: 0, limit: 1 }), []);
  assert.equal(authCount, 2);
  assert.equal(catalogCount, 2);
});
