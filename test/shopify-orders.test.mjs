import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cancelOrder,
  createOrder,
  deleteOrder,
  listOrders,
  summarizeOrders,
  updateOrder,
} from "../dist/shopify/operations/orders.js";
import {
  createFulfillment,
  listOrderFulfillments,
} from "../dist/shopify/operations/fulfillments.js";
import { registerShopifyOrderTools } from "../dist/tools/shopify-orders.js";

function order(id, amount, options = {}) {
  return {
    id: `gid://shopify/Order/${id}`,
    name: `#${id}`,
    createdAt: "2026-09-01T12:00:00Z",
    cancelledAt: null,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    test: false,
    currentTotalPriceSet: { shopMoney: { amount, currencyCode: "USD" } },
    ...options,
  };
}

test("order list passes cursor and search to Shopify and returns the next cursor", async () => {
  let variables;
  const client = { query: async (_query, input) => {
    variables = input;
    return { orders: { nodes: [order(1, "2.00")], pageInfo: { hasNextPage: true, endCursor: "next" } } };
  } };
  const page = await listOrders(client, { first: 25, after: "previous", search: "status:any" });
  assert.equal(page.pageInfo.endCursor, "next");
  assert.deepEqual(variables, { first: 25, after: "previous", search: "status:any" });
});

test("order mutations surface user errors and require a confirmed deleted ID", async () => {
  const rejected = { query: async () => ({ orderUpdate: {
    order: null, userErrors: [{ field: ["note"], message: "Cannot update" }],
  } }) };
  await assert.rejects(() => updateOrder(rejected, { id: "gid://shopify/Order/1", note: "New" }), /Cannot update/);

  const unconfirmed = { query: async () => ({ orderDelete: { deletedId: null, userErrors: [] } }) };
  await assert.rejects(() => deleteOrder(unconfirmed, "gid://shopify/Order/1"), /no data/i);
});

test("order creation uses inventory policy and does not send receipts by default", async () => {
  let variables;
  const client = { query: async (_query, input) => {
    variables = input;
    return { orderCreate: { order: order(1, "10.00"), userErrors: [] } };
  } };
  await createOrder(client, { lineItems: [{ variantId: "gid://shopify/ProductVariant/12", quantity: 2 }] });
  assert.equal(variables.options.inventoryBehaviour, "DECREMENT_OBEYING_POLICY");
  assert.equal(variables.options.sendReceipt, false);
  assert.deepEqual(variables.order.lineItems, [{ variantId: "gid://shopify/ProductVariant/12", quantity: 2 }]);
});

test("summary excludes cancelled and test orders and reports page completeness", async () => {
  const calls = [];
  const pages = [
    { orders: { nodes: [order(1, "10.25"), order(2, "20.00", { cancelledAt: "2026-09-02T00:00:00Z" })], pageInfo: { hasNextPage: true, endCursor: "c1" } } },
    { orders: { nodes: [order(3, "0.80"), order(4, "100.00", { test: true })], pageInfo: { hasNextPage: false, endCursor: null } } },
  ];
  const client = { query: async (_query, variables) => {
    calls.push(variables);
    return pages.shift();
  } };
  const result = await summarizeOrders(client, { from: "2026-09-01", toExclusive: "2026-09-04", maxPages: 2 });
  assert.equal(result.currentOrderTotal.amount, "11.05");
  assert.equal(result.orderCount, 3);
  assert.equal(result.cancelledOrderCount, 1);
  assert.deepEqual(result.byFinancialStatus, { PAID: 2 });
  assert.deepEqual(result.byFulfillmentStatus, { UNFULFILLED: 2 });
  assert.equal(result.paginationComplete, true);
  assert.equal(result.pagesRead, 2);
  assert.equal(calls[1].after, "c1");
  assert.match(calls[0].search, /test:false/);
});

test("summary marks a capped result incomplete", async () => {
  const client = { query: async () => ({ orders: {
    nodes: [order(1, "1.00")], pageInfo: { hasNextPage: true, endCursor: "next" },
  } }) };
  const result = await summarizeOrders(client, { from: "2026-09-01", toExclusive: "2026-09-02", maxPages: 1 });
  assert.equal(result.paginationComplete, false);
  assert.equal(result.nextCursor, "next");
  assert.equal(result.pagesRead, 1);
});

test("cancellation passes explicit refund and restock choices without claiming completion", async () => {
  let variables;
  const client = { query: async (_query, input) => {
    variables = input;
    return { orderCancel: {
      job: { id: "gid://shopify/Job/abc", done: false }, orderCancelUserErrors: [],
    } };
  } };
  const result = await cancelOrder(client, {
    orderId: "gid://shopify/Order/1", reason: "CUSTOMER",
    refundToOriginalPaymentMethod: false, restock: true, notifyCustomer: false,
  });
  assert.deepEqual(variables.refundMethod, { originalPaymentMethodsRefund: false });
  assert.equal(variables.restock, true);
  assert.equal(result.status, "accepted_for_processing");
  assert.equal(result.jobDone, false);
});

test("cancellation rejects Shopify user errors and missing jobs", async () => {
  const rejected = { query: async () => ({ orderCancel: {
    job: null, orderCancelUserErrors: [{ field: ["orderId"], message: "Cannot cancel", code: "INVALID" }],
  } }) };
  const input = { orderId: "gid://shopify/Order/1", reason: "OTHER",
    refundToOriginalPaymentMethod: false, restock: false, notifyCustomer: false };
  await assert.rejects(() => cancelOrder(rejected, input), /Cannot cancel/);
  const ambiguous = { query: async () => ({ orderCancel: { job: null, orderCancelUserErrors: [] } }) };
  await assert.rejects(() => cancelOrder(ambiguous, input), /cancellation job/);
});

test("fulfillment listing preserves pagination and fulfillment creation targets one order", async () => {
  let variables;
  const listing = { query: async (_query, input) => {
    variables = input;
    return { order: { fulfillmentOrders: {
      nodes: [{ id: "gid://shopify/FulfillmentOrder/11", status: "OPEN", requestStatus: "UNSUBMITTED" }],
      pageInfo: { hasNextPage: true, endCursor: "next" },
    } } };
  } };
  const page = await listOrderFulfillments(listing, "gid://shopify/Order/1", "previous");
  assert.equal(variables.after, "previous");
  assert.equal(page.fulfillmentOrders.pageInfo.endCursor, "next");

  const creation = { query: async (_query, input) => {
    variables = input;
    return { fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/21", status: "SUCCESS" }, userErrors: [] } };
  } };
  const fulfillment = await createFulfillment(creation, {
    fulfillmentOrderId: "gid://shopify/FulfillmentOrder/11",
    notifyCustomer: false, trackingNumber: "TRACK123",
  });
  assert.equal(fulfillment.id, "gid://shopify/Fulfillment/21");
  assert.deepEqual(variables.fulfillment.lineItemsByFulfillmentOrder,
    [{ fulfillmentOrderId: "gid://shopify/FulfillmentOrder/11" }]);
  assert.equal(variables.fulfillment.trackingInfo.number, "TRACK123");
});

test("registers scoped order tools with destructive deletion metadata", () => {
  const tools = new Map();
  const server = { registerTool(name, config) { tools.set(name, config); } };
  registerShopifyOrderTools(server, {});
  assert.equal(tools.size, 9);
  assert.equal(tools.get("shopify_order_delete").annotations.destructiveHint, true);
  assert.equal(tools.get("shopify_order_cancel").annotations.destructiveHint, true);
  assert.equal(tools.get("shopify_fulfillment_create").annotations.destructiveHint, true);
  assert.equal(tools.get("shopify_order_summary").annotations.readOnlyHint, true);
});
