import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { unwrapMutation } from "./mutation.js";

interface FulfillmentOrderPage {
  nodes: Array<{ id: string; status: string; requestStatus: string }>;
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export async function listOrderFulfillments(
  client: ShopifyClient,
  orderId: string,
  after?: string,
): Promise<{ orderId: string; fulfillmentOrders: FulfillmentOrderPage }> {
  const data = await client.query<{ order: { fulfillmentOrders: FulfillmentOrderPage } | null }>(
    `query OrderFulfillmentOrders($orderId: ID!, $after: String) {
      order(id: $orderId) {
        fulfillmentOrders(first: 50, after: $after) {
          nodes { id status requestStatus }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { orderId, after },
  );
  if (!data.order) throw new Error(`Shopify order ${orderId} was not found or is not accessible`);
  const page = data.order.fulfillmentOrders;
  if (!page?.nodes || !page.pageInfo) throw new Error("Shopify returned an invalid fulfillment order page");
  if (page.pageInfo.hasNextPage && !page.pageInfo.endCursor) {
    throw new Error("Shopify fulfillment order page has no next cursor");
  }
  return { orderId, fulfillmentOrders: page };
}

export interface CreateFulfillmentInput {
  fulfillmentOrderId: string;
  notifyCustomer: boolean;
  trackingNumber?: string;
  trackingCompany?: string;
  trackingUrl?: string;
}

export async function createFulfillment(client: ShopifyClient, input: CreateFulfillmentInput) {
  const trackingInfo = input.trackingNumber
    ? { number: input.trackingNumber, company: input.trackingCompany, url: input.trackingUrl }
    : undefined;
  const data = await client.query<{
    fulfillmentCreate: {
      fulfillment: { id: string; status: string } | null;
      userErrors: UserError[];
    } | null;
  }>(
    `mutation FulfillmentCreate($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`,
    {
      fulfillment: {
        lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: input.fulfillmentOrderId }],
        notifyCustomer: input.notifyCustomer,
        trackingInfo,
      },
    },
  );
  if (!data.fulfillmentCreate) throw new Error("Shopify returned no fulfillmentCreate result");
  return unwrapMutation(
    "fulfillmentCreate",
    data.fulfillmentCreate.fulfillment,
    data.fulfillmentCreate.userErrors,
  );
}
