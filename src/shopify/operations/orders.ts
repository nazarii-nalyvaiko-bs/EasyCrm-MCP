import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { addDecimal } from "../../money.js";
import { unwrapMutation } from "./mutation.js";

const ORDER_FIELDS = `
  id
  name
  createdAt
  cancelledAt
  displayFinancialStatus
  displayFulfillmentStatus
  test
  currentTotalPriceSet { shopMoney { amount currencyCode } }
`;

const ORDERS_QUERY = `
  query Orders($first: Int!, $after: String, $search: String) {
    orders(first: $first, after: $after, query: $search, sortKey: CREATED_AT) {
      nodes { ${ORDER_FIELDS} }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface Money {
  amount: string;
  currencyCode: string;
}

export interface OrderSummary {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string;
  test: boolean;
  currentTotalPriceSet: { shopMoney: Money };
}

interface OrdersPage {
  nodes: OrderSummary[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

function checkedPayload<T>(payload: { userErrors: UserError[]; order?: T | null } | null | undefined, action: string): T {
  if (!payload) throw new Error(`Shopify returned no ${action} result`);
  return unwrapMutation(action, payload.order, payload.userErrors);
}

export async function listOrders(
  client: ShopifyClient,
  input: { first: number; after?: string; search?: string },
): Promise<OrdersPage> {
  const data = await client.query<{ orders: OrdersPage }>(ORDERS_QUERY, input);
  if (!data.orders?.nodes || !data.orders.pageInfo) {
    throw new Error("Shopify returned an invalid orders page");
  }
  const { hasNextPage, endCursor } = data.orders.pageInfo;
  if (hasNextPage && !endCursor) throw new Error("Shopify orders page has no next cursor");
  return data.orders;
}

export async function getOrder(client: ShopifyClient, id: string): Promise<OrderSummary> {
  const data = await client.query<{ order: OrderSummary | null }>(
    `query Order($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`,
    { id },
  );
  if (!data.order) throw new Error(`Shopify order ${id} was not found or is not accessible`);
  return data.order;
}

export interface CreateOrderInput {
  lineItems: Array<{ variantId: string; quantity: number }>;
  email?: string;
  note?: string;
  tags?: string[];
  sendReceipt?: boolean;
}

export async function createOrder(client: ShopifyClient, input: CreateOrderInput): Promise<OrderSummary> {
  const { sendReceipt = false, ...order } = input;
  const data = await client.query<{
    orderCreate: { order: OrderSummary | null; userErrors: UserError[] } | null;
  }>(
    `mutation OrderCreate($order: OrderCreateOrderInput!, $options: OrderCreateOptionsInput) {
      orderCreate(order: $order, options: $options) {
        order { ${ORDER_FIELDS} }
        userErrors { field message }
      }
    }`,
    { order, options: { sendReceipt, inventoryBehaviour: "DECREMENT_OBEYING_POLICY" } },
  );
  return checkedPayload(data.orderCreate, "orderCreate");
}

export interface UpdateOrderInput {
  id: string;
  note?: string;
  tags?: string[];
  email?: string;
}

export async function updateOrder(client: ShopifyClient, input: UpdateOrderInput): Promise<OrderSummary> {
  const data = await client.query<{
    orderUpdate: { order: OrderSummary | null; userErrors: UserError[] } | null;
  }>(
    `mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { ${ORDER_FIELDS} }
        userErrors { field message }
      }
    }`,
    { input },
  );
  return checkedPayload(data.orderUpdate, "orderUpdate");
}

export async function deleteOrder(client: ShopifyClient, orderId: string): Promise<{ deletedId: string }> {
  const data = await client.query<{
    orderDelete: { deletedId: string | null; userErrors: UserError[] } | null;
  }>(
    `mutation OrderDelete($orderId: ID!) {
      orderDelete(orderId: $orderId) {
        deletedId
        userErrors { field message }
      }
    }`,
    { orderId },
  );
  if (!data.orderDelete) throw new Error("Shopify returned no orderDelete result");
  const deletedId = unwrapMutation("orderDelete", data.orderDelete.deletedId, data.orderDelete.userErrors);
  if (deletedId !== orderId) {
    throw new Error("Shopify did not confirm deletion of the requested order");
  }
  return { deletedId: orderId };
}

export type CancelReason = "CUSTOMER" | "DECLINED" | "FRAUD" | "INVENTORY" | "OTHER" | "STAFF";

export interface CancelOrderInput {
  orderId: string;
  reason: CancelReason;
  refundToOriginalPaymentMethod: boolean;
  restock: boolean;
  notifyCustomer: boolean;
  staffNote?: string;
}

export async function cancelOrder(client: ShopifyClient, input: CancelOrderInput) {
  const data = await client.query<{
    orderCancel: {
      job: { id: string; done: boolean } | null;
      orderCancelUserErrors: Array<UserError & { code?: string | null }>;
    } | null;
  }>(
    `mutation OrderCancel(
      $orderId: ID!, $reason: OrderCancelReason!, $refundMethod: OrderCancelRefundMethodInput!,
      $restock: Boolean!, $notifyCustomer: Boolean, $staffNote: String
    ) {
      orderCancel(
        orderId: $orderId, reason: $reason, refundMethod: $refundMethod,
        restock: $restock, notifyCustomer: $notifyCustomer, staffNote: $staffNote
      ) {
        job { id done }
        orderCancelUserErrors { field message code }
      }
    }`,
    {
      orderId: input.orderId,
      reason: input.reason,
      refundMethod: { originalPaymentMethodsRefund: input.refundToOriginalPaymentMethod },
      restock: input.restock,
      notifyCustomer: input.notifyCustomer,
      staffNote: input.staffNote,
    },
  );
  const payload = data.orderCancel;
  if (!payload) throw new Error("Shopify returned no orderCancel result");
  if (payload.orderCancelUserErrors?.length) {
    throw new Error(`orderCancel rejected: ${payload.orderCancelUserErrors.map((error) => error.message).join("; ")}`);
  }
  if (!payload.job?.id) throw new Error("Shopify did not return a cancellation job");
  return {
    orderId: input.orderId,
    jobId: payload.job.id,
    jobDone: payload.job.done,
    status: "accepted_for_processing",
    note: "Cancellation is asynchronous. Read the order again to verify cancelledAt and payment state.",
  };
}

export async function summarizeOrders(
  client: ShopifyClient,
  input: { from: string; toExclusive: string; maxPages: number },
) {
  if (input.from >= input.toExclusive) throw new Error("from must be earlier than toExclusive");
  if (!Number.isInteger(input.maxPages) || input.maxPages < 1 || input.maxPages > 100) {
    throw new Error("maxPages must be between 1 and 100");
  }
  const search = `status:any created_at:>=${input.from} created_at:<${input.toExclusive} test:false`;
  let after: string | undefined;
  let hasNextPage = false;
  let count = 0;
  let cancelledCount = 0;
  let amount = "0";
  let currency: string | undefined;
  let pagesRead = 0;
  const byFinancialStatus = new Map<string, number>();
  const byFulfillmentStatus = new Map<string, number>();
  while (pagesRead < input.maxPages) {
    const page = await listOrders(client, { first: 100, after, search });
    pagesRead += 1;
    for (const order of page.nodes) {
      if (order.test) continue;
      count += 1;
      if (order.cancelledAt) {
        cancelledCount += 1;
        continue;
      }
      const financialStatus = order.displayFinancialStatus ?? "UNKNOWN";
      byFinancialStatus.set(financialStatus, (byFinancialStatus.get(financialStatus) ?? 0) + 1);
      byFulfillmentStatus.set(order.displayFulfillmentStatus,
        (byFulfillmentStatus.get(order.displayFulfillmentStatus) ?? 0) + 1);
      const money = order.currentTotalPriceSet?.shopMoney;
      if (!money?.currencyCode || typeof money.amount !== "string") {
        throw new Error(`Shopify order ${order.id} has no current total`);
      }
      if (currency && currency !== money.currencyCode) {
        throw new Error("Shopify returned mixed shop currencies in the order summary");
      }
      currency = money.currencyCode;
      amount = addDecimal(amount, money.amount);
    }
    hasNextPage = page.pageInfo.hasNextPage;
    if (!hasNextPage) break;
    after = page.pageInfo.endCursor ?? undefined;
  }
  return {
    from: input.from,
    toExclusive: input.toExclusive,
    source: "Shopify Admin API orders, computed by EasyCRM MCP",
    metric: "Sum of current order totals after returns, including taxes and discounts, excluding cancelled and test orders. This is not payment revenue.",
    orderCount: count,
    cancelledOrderCount: cancelledCount,
    byFinancialStatus: Object.fromEntries(byFinancialStatus),
    byFulfillmentStatus: Object.fromEntries(byFulfillmentStatus),
    currentOrderTotal: { amount, currencyCode: currency ?? null },
    pagesRead,
    paginationComplete: !hasNextPage,
    nextCursor: hasNextPage ? after : null,
    accessNote: "Shopify normally limits order access to 60 days unless read_all_orders is granted.",
  };
}
