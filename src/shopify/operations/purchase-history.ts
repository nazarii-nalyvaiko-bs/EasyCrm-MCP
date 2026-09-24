import { z } from "zod";
import type { ShopifyClient } from "../client.js";

const customerIdSchema = z.string().regex(/^gid:\/\/shopify\/Customer\/\d+$/);
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const lineItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  variantTitle: z.string().nullable(),
  sku: z.string().nullable(),
  quantity: z.number().int().nonnegative(),
  product: z.object({ id: z.string() }).nullable(),
  variant: z.object({ id: z.string() }).nullable(),
});
const orderSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  displayFinancialStatus: z.string().nullable(),
  displayFulfillmentStatus: z.string(),
  currentTotalPriceSet: z.object({
    shopMoney: z.object({ amount: z.string(), currencyCode: z.string() }),
  }),
  lineItems: z.object({ nodes: z.array(lineItemSchema), pageInfo: pageInfoSchema }),
});
const historySchema = z.object({
  orders: z.object({ nodes: z.array(orderSchema), pageInfo: pageInfoSchema }),
});
const orderItemsSchema = z.object({
  order: z.object({
    lineItems: z.object({ nodes: z.array(lineItemSchema), pageInfo: pageInfoSchema }),
  }).nullable(),
});

export interface PurchaseHistoryInput {
  customerId: string;
  first: number;
  after?: string;
}

const PURCHASE_HISTORY_QUERY = `
  query CustomerPurchaseHistory($first: Int!, $after: String, $search: String!) {
    orders(first: $first, after: $after, query: $search, sortKey: CREATED_AT, reverse: true) {
      nodes {
        id name createdAt cancelledAt displayFinancialStatus displayFulfillmentStatus
        currentTotalPriceSet { shopMoney { amount currencyCode } }
        lineItems(first: 20) {
          nodes { id title variantTitle sku quantity product { id } variant { id } }
          pageInfo { hasNextPage endCursor }
        }
      }
      pageInfo { hasNextPage endCursor }
    }
  }`;

export async function getPurchaseHistory(client: ShopifyClient, input: PurchaseHistoryInput) {
  const customerId = customerIdSchema.parse(input.customerId);
  const search = `customer_id:${customerId.slice("gid://shopify/Customer/".length)}`;
  const response = await client.query<unknown>(PURCHASE_HISTORY_QUERY, {
    first: input.first,
    after: input.after,
    search,
  });
  const parsed = historySchema.safeParse(response);
  if (!parsed.success) throw new Error("Shopify returned an invalid customer purchase history");
  const { nodes, pageInfo } = parsed.data.orders;
  if (pageInfo.hasNextPage && !pageInfo.endCursor) {
    throw new Error("Shopify purchase history has no next cursor");
  }
  if (nodes.some((order) => order.lineItems.pageInfo.hasNextPage && !order.lineItems.pageInfo.endCursor)) {
    throw new Error("Shopify order items have no next cursor");
  }
  return {
    customerId,
    orders: nodes.map(({ lineItems, ...order }) => ({
      ...order,
      items: lineItems.nodes,
      itemsComplete: !lineItems.pageInfo.hasNextPage,
      nextItemsCursor: lineItems.pageInfo.hasNextPage ? lineItems.pageInfo.endCursor : null,
    })),
    pageInfo,
  };
}

export async function listOrderItems(client: ShopifyClient, orderId: string, first: number, after?: string) {
  const response = await client.query<unknown>(
    `query PurchaseHistoryOrderItems($orderId: ID!, $first: Int!, $after: String) {
      order(id: $orderId) {
        lineItems(first: $first, after: $after) {
          nodes { id title variantTitle sku quantity product { id } variant { id } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { orderId, first, after },
  );
  const parsed = orderItemsSchema.safeParse(response);
  if (!parsed.success) throw new Error("Shopify returned invalid order items");
  if (!parsed.data.order) throw new Error(`Shopify order ${orderId} was not found or is not accessible`);
  const { nodes, pageInfo } = parsed.data.order.lineItems;
  if (pageInfo.hasNextPage && !pageInfo.endCursor) throw new Error("Shopify order items have no next cursor");
  return { orderId, items: nodes, pageInfo };
}
