import assert from "node:assert/strict";
import { test } from "node:test";
import { HoroshopClient } from "../dist/horoshop/client.js";
import { listCategories } from "../dist/horoshop/categories.js";
import { normalizeHoroshopUrl } from "../dist/horoshop/config.js";
import { upsertCustomer } from "../dist/horoshop/customers.js";
import { listOrders, listOrderStatuses, summarizeOrders, updateOrder } from "../dist/horoshop/orders.js";
import { listProducts, updateProduct } from "../dist/horoshop/products.js";

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

test("updates only supplied product fields after finding the exact article", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (url.endsWith("/auth/")) return Response.json({ status: "OK", response: { token: "token" } });
    if (url.endsWith("/catalog/export/")) return Response.json({ status: "OK", response: { products: [{ article: "SKU-1" }] } });
    return Response.json({ status: "OK" });
  });
  const result = await updateProduct(new HoroshopClient(config), { article: "SKU-1", price: 42, visible: false });
  assert.deepEqual(result, { article: "SKU-1", updated: true });
  assert.deepEqual(requests[2].body, {
    token: "token", products: [{ article: "SKU-1", price: 42, display_in_showcase: false }],
  });
  assert.equal(requests[2].url, "https://shop.example.com/api/catalog/import/");
});

test("does not import a product when the article is absent", async (t) => {
  const operations = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    operations.push(url);
    return Response.json(url.endsWith("/auth/")
      ? { status: "OK", response: { token: "token" } }
      : { status: "EMPTY" });
  });
  await assert.rejects(updateProduct(new HoroshopClient(config), { article: "missing", price: 42 }), /not found/);
  assert.equal(operations.some((url) => url.endsWith("/catalog/import/")), false);
});

test("lists orders and configured statuses", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url.endsWith("/auth/")) return Response.json({ status: "OK", response: { token: "token" } });
    if (url.endsWith("/orders/get_available_statuses/")) {
      return Response.json({ status: "OK", response: { statuses: { 3: { id: 3, title: { ua: "Доставлено" }, is_successful: 1 } } } });
    }
    return Response.json({ status: "OK", response: { orders: [{ order_id: 10, stat_status: 3, total_sum: 20, currency: "UAH" }] } });
  });
  const client = new HoroshopClient(config);
  assert.equal((await listOrders(client, { offset: 0, limit: 20 }))[0].order_id, 10);
  assert.deepEqual(await listOrderStatuses(client), [{ id: 3, title: { ua: "Доставлено" }, is_successful: 1 }]);
});

test("rejects unconfirmed order updates, including partial success", async (t) => {
  let response = { status: "WARNING", response: { log: [{ status: "ERROR", messages: "invalid status" }] } };
  t.mock.method(globalThis, "fetch", async (url) => Response.json(url.endsWith("/auth/")
    ? { status: "OK", response: { token: "token" } }
    : response));
  const client = new HoroshopClient(config);
  await assert.rejects(updateOrder(client, { orderId: 10, paid: true }), /WARNING/);
  response = { status: "OK", response: { log: [{ status: "ERROR", messages: "invalid status" }] } };
  await assert.rejects(updateOrder(client, { orderId: 10, paid: true }), /did not confirm/);
  response = { status: "OK", response: { log: [{ status: "OK", messages: "UPDATED" }] } };
  assert.deepEqual(await updateOrder(client, { orderId: 10, paid: true }), { orderId: 10, updated: true });
});

test("marks derived order analytics incomplete when the page cap is reached", async (t) => {
  const offsets = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (url.endsWith("/auth/")) return Response.json({ status: "OK", response: { token: "token" } });
    const { offset } = JSON.parse(options.body);
    offsets.push(offset);
    return Response.json({ status: "OK", response: { orders: Array.from({ length: 100 }, (_, index) => ({
      order_id: offset + index + 1,
      stat_status: 3,
      payed: 1,
      total_sum: 12.5,
      currency: "UAH",
      analytics: { utm_source: "search" },
    })) } });
  });
  const summary = await summarizeOrders(new HoroshopClient(config), "2026-09-01", "2026-09-24", 2);
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(summary.orderCount, 200);
  assert.equal(summary.paidOrderCount, 200);
  assert.deepEqual(summary.totalsByCurrency, { UAH: 2500 });
  assert.deepEqual(summary.countsByUtmSource, { search: 200 });
  assert.equal(summary.complete, false);
});

test("reads Horoshop child categories and imports one customer", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    if (url.endsWith("/auth/")) return Response.json({ status: "OK", response: { token: "token" } });
    if (url.endsWith("/pages/export/")) return Response.json({ status: "OK", response: { pages: [{ id: 8, parent: 0, title: { ua: "Одяг" } }] } });
    return Response.json({ status: "OK", response: { log: [{ code: "OK" }] } });
  });
  const client = new HoroshopClient(config);
  assert.deepEqual(await listCategories(client), [{ id: 8, parent: 0, title: { ua: "Одяг" } }]);
  assert.deepEqual(await upsertCustomer(client, { name: "Test User", email: "test@example.com", note: "VIP" }), {
    email: "test@example.com", saved: true,
  });
  assert.deepEqual(requests[1].body, { parent: 0, token: "token" });
  assert.deepEqual(requests[2].body, { users: [{ title: "Test User", email: "test@example.com", note: "VIP" }], token: "token" });
});
