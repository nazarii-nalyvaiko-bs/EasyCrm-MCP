import assert from "node:assert/strict";
import { test } from "node:test";
import { getPurchaseHistory as getShopifyHistory, listOrderItems } from "../dist/shopify/operations/purchase-history.js";
import { getPurchaseHistory as getHoroshopHistory } from "../dist/horoshop/purchase-history.js";

const item = {
  id: "gid://shopify/LineItem/10",
  title: "Blue shirt",
  variantTitle: "Large",
  sku: "SHIRT-L",
  quantity: 2,
  product: { id: "gid://shopify/Product/11" },
  variant: { id: "gid://shopify/ProductVariant/12" },
};
const shopifyOrder = {
  id: "gid://shopify/Order/1",
  name: "#1001",
  createdAt: "2026-09-01T12:00:00Z",
  cancelledAt: null,
  displayFinancialStatus: "PAID",
  displayFulfillmentStatus: "FULFILLED",
  currentTotalPriceSet: { shopMoney: { amount: "50.00", currencyCode: "USD" } },
  lineItems: { nodes: [item], pageInfo: { hasNextPage: true, endCursor: "item-cursor" } },
};

test("Shopify purchase history filters by customer ID and exposes both pagination levels", async () => {
  let sent;
  const client = { query: async (query, variables) => {
    sent = { query, variables };
    return { orders: {
      nodes: [shopifyOrder],
      pageInfo: { hasNextPage: true, endCursor: "order-cursor" },
    } };
  } };
  const history = await getShopifyHistory(client, {
    customerId: "gid://shopify/Customer/42", first: 20, after: "previous",
  });
  assert.deepEqual(sent.variables, { first: 20, after: "previous", search: "customer_id:42" });
  assert.match(sent.query, /sortKey: CREATED_AT, reverse: true/);
  assert.match(sent.query, /lineItems\(first: 20\)/);
  assert.equal(history.pageInfo.endCursor, "order-cursor");
  assert.equal(history.orders[0].items[0].sku, "SHIRT-L");
  assert.equal(history.orders[0].itemsComplete, false);
  assert.equal(history.orders[0].nextItemsCursor, "item-cursor");
  assert.equal("lineItems" in history.orders[0], false);
});

test("Shopify order items continue from the reported item cursor", async () => {
  let variables;
  const client = { query: async (_query, input) => {
    variables = input;
    return { order: { lineItems: {
      nodes: [item], pageInfo: { hasNextPage: false, endCursor: null },
    } } };
  } };
  const page = await listOrderItems(client, "gid://shopify/Order/1", 100, "item-cursor");
  assert.deepEqual(variables, { orderId: "gid://shopify/Order/1", first: 100, after: "item-cursor" });
  assert.equal(page.items[0].title, "Blue shirt");
  assert.equal(page.pageInfo.hasNextPage, false);
});

test("Shopify purchase history rejects missing pagination cursors", async () => {
  const noOrderCursor = { query: async () => ({ orders: {
    nodes: [], pageInfo: { hasNextPage: true, endCursor: null },
  } }) };
  await assert.rejects(
    getShopifyHistory(noOrderCursor, { customerId: "gid://shopify/Customer/42", first: 1 }),
    /no next cursor/,
  );
  const noItemCursor = { query: async () => ({ orders: {
    nodes: [{ ...shopifyOrder, lineItems: {
      nodes: [item], pageInfo: { hasNextPage: true, endCursor: null },
    } }],
    pageInfo: { hasNextPage: false, endCursor: null },
  } }) };
  await assert.rejects(
    getShopifyHistory(noItemCursor, { customerId: "gid://shopify/Customer/42", first: 1 }),
    /items have no next cursor/,
  );
});

function horoshopOrder(id, email) {
  return {
    order_id: id,
    delivery_email: email,
    stat_created: "2026-09-01 12:00:00",
    stat_status: 3,
    payed: 1,
    total_sum: 120.5,
    currency: "UAH",
    products: [{ title: "Blue shirt", article: "SHIRT-L", quantity: 2, price: 60.25 }],
  };
}

test("Horoshop history matches exact email across bounded order pages and resumes", async () => {
  const calls = [];
  const client = { request: async (operation, input) => {
    calls.push({ operation, input });
    const orders = input.offset === 0
      ? [horoshopOrder(1, "OTHER@example.com"), ...Array.from({ length: 99 }, (_, index) => horoshopOrder(index + 2, "buyer@example.com"))]
      : [horoshopOrder(101, "BUYER@example.com"), horoshopOrder(102, "buyer+other@example.com")];
    return { status: "OK", response: { orders } };
  } };
  const input = { email: "buyer@example.com", offset: 0, maxPages: 1, from: "2026-09-01" };
  const first = await getHoroshopHistory(client, input);
  assert.equal(first.orders.length, 99);
  assert.equal(first.complete, false);
  assert.equal(first.nextOffset, 100);
  assert.equal(first.orders[0].products[0].price, "60.25");
  const second = await getHoroshopHistory(client, { ...input, offset: first.nextOffset });
  assert.deepEqual(second.orders.map((order) => order.order_id), [101]);
  assert.equal(second.complete, true);
  assert.equal(second.nextOffset, null);
  assert.deepEqual(calls.map(({ operation, input: request }) => [operation, request.offset, request.limit, request.from]), [
    ["orders/get", 0, 100, "2026-09-01"],
    ["orders/get", 100, 100, "2026-09-01"],
  ]);
});

test("Horoshop history rejects matched orders without purchase items", async () => {
  const client = { request: async () => ({ status: "OK", response: {
    orders: [{ order_id: 1, delivery_email: "buyer@example.com" }],
  } }) };
  await assert.rejects(
    getHoroshopHistory(client, { email: "buyer@example.com", offset: 0, maxPages: 1 }),
    /invalid purchase history data/,
  );
});
