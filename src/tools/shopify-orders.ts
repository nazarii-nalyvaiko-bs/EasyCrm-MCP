import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import {
  cancelOrder,
  createOrder,
  deleteOrder,
  getOrder,
  listOrders,
  summarizeOrders,
  updateOrder,
} from "../shopify/operations/orders.js";
import { createFulfillment, listOrderFulfillments } from "../shopify/operations/fulfillments.js";
import { getPurchaseHistory, listOrderItems } from "../shopify/operations/purchase-history.js";

const orderId = z.string().regex(/^gid:\/\/shopify\/Order\/\d+$/).describe("Shopify order GID");
const customerId = z.string().regex(/^gid:\/\/shopify\/Customer\/\d+$/).describe("Shopify customer GID");
const date = z.iso.date().describe("UTC calendar date, YYYY-MM-DD");

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function guarded<Input>(handler: (input: Input) => Promise<CallToolResult>) {
  return async (input: Input): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const scopeHint = error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")
        ? " Check the app's Shopify order scopes and reinstall it after granting them."
        : "";
      return { content: [{ type: "text", text: `${message}${scopeHint}` }], isError: true };
    }
  };
}

export function registerShopifyOrderTools(server: McpServer, client: ShopifyClient): void {
  server.registerTool(
    "shopify_customer_purchase_history",
    {
      title: "Read Shopify customer purchase history",
      description: "Read orders for a Shopify customer ID, newest first, including up to 20 line items per order. Follow pageInfo for more orders and use shopify_order_line_items when itemsComplete is false. Requires read_orders; orders older than 60 days need read_all_orders.",
      inputSchema: {
        customerId,
        first: z.number().int().min(1).max(25).default(20),
        after: z.string().min(1).optional().describe("Next order cursor from pageInfo"),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async (input) => result(await getPurchaseHistory(client, input))),
  );

  server.registerTool(
    "shopify_order_line_items",
    {
      title: "Read Shopify order line items",
      description: "Read a cursor page of line items for an order. Use this to fetch remaining items when purchase history reports itemsComplete=false. Requires read_orders.",
      inputSchema: {
        orderId,
        first: z.number().int().min(1).max(100).default(100),
        after: z.string().min(1).optional().describe("Next line item cursor from pageInfo or nextItemsCursor"),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ orderId, first, after }) => result(await listOrderItems(client, orderId, first, after))),
  );

  server.registerTool(
    "shopify_order_list",
    {
      title: "List Shopify orders",
      description: "Read a cursor page of orders. Shopify search syntax is supported. Requires read_orders; orders older than 60 days need read_all_orders.",
      inputSchema: {
        first: z.number().int().min(1).max(100).default(50),
        after: z.string().optional().describe("Next cursor from the previous page"),
        search: z.string().max(500).optional().describe("Shopify order search query, for example status:any created_at:>=2026-09-01"),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async (input) => result(await listOrders(client, input))),
  );

  server.registerTool(
    "shopify_order_get",
    {
      title: "Get Shopify order",
      description: "Read one order by GID. Returns status and current total, without customer personal data.",
      inputSchema: { id: orderId },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ id }) => result(await getOrder(client, id))),
  );

  server.registerTool(
    "shopify_order_create",
    {
      title: "Create Shopify order",
      description: "Create an order from existing variant IDs. Inventory follows its policy. Receipt email is off by default. Requires write_orders and an offline app token. This creates an order, not a checkout.",
      inputSchema: {
        lineItems: z.array(z.object({
          variantId: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
          quantity: z.number().int().min(1),
        })).min(1).max(100),
        email: z.email().optional(),
        note: z.string().max(5000).optional(),
        tags: z.array(z.string().min(1)).max(100).optional(),
        sendReceipt: z.boolean().default(false),
      },
    },
    guarded(async (input) => result(await createOrder(client, input))),
  );

  server.registerTool(
    "shopify_order_update",
    {
      title: "Update Shopify order",
      description: "Update note, email, or tags on an order. Supplied tags replace the complete tag list. Line items and discounts require Shopify's order edit workflow.",
      inputSchema: {
        id: orderId,
        note: z.string().max(5000).optional(),
        email: z.email().optional(),
        tags: z.array(z.string().min(1)).max(100).optional(),
      },
      annotations: { destructiveHint: true },
    },
    guarded(async (input) => {
      if (input.note === undefined && input.email === undefined && input.tags === undefined) {
        throw new Error("Provide at least one order field to update");
      }
      return result(await updateOrder(client, input));
    }),
  );

  server.registerTool(
    "shopify_order_delete",
    {
      title: "Delete Shopify order",
      description: "Permanently delete an eligible order. Shopify only permits deletion of certain order types. Requires write_orders and user delete_orders permission. This cannot be undone.",
      inputSchema: { orderId },
      annotations: { destructiveHint: true },
    },
    guarded(async ({ orderId }) => result(await deleteOrder(client, orderId))),
  );

  server.registerTool(
    "shopify_order_cancel",
    {
      title: "Cancel Shopify order",
      description: "Submit irreversible order cancellation. Explicitly choose refund to original payment method, inventory restock, and customer notification. Shopify processes cancellation asynchronously; inspect the returned job and reread the order to verify its final state. Requires write_orders.",
      inputSchema: {
        orderId,
        reason: z.enum(["CUSTOMER", "DECLINED", "FRAUD", "INVENTORY", "OTHER", "STAFF"]),
        refundToOriginalPaymentMethod: z.boolean(),
        restock: z.boolean(),
        notifyCustomer: z.boolean(),
        staffNote: z.string().max(255).optional(),
      },
      annotations: { destructiveHint: true },
    },
    guarded(async (input) => result(await cancelOrder(client, input))),
  );

  server.registerTool(
    "shopify_order_fulfillment_orders",
    {
      title: "List Shopify fulfillment orders",
      description: "List a cursor page of fulfillment orders belonging to an order. Results depend on the app's fulfillment order read scopes.",
      inputSchema: { orderId, after: z.string().optional() },
      annotations: { readOnlyHint: true },
    },
    guarded(async ({ orderId, after }) => result(await listOrderFulfillments(client, orderId, after))),
  );

  server.registerTool(
    "shopify_fulfillment_create",
    {
      title: "Create Shopify fulfillment",
      description: "Fulfill all remaining items in one fulfillment order. Requires a fulfillment order write scope and user fulfill_and_ship_orders permission. Notification is off by default. Use shopify_order_fulfillment_orders to find the ID.",
      inputSchema: {
        fulfillmentOrderId: z.string().regex(/^gid:\/\/shopify\/FulfillmentOrder\/\d+$/),
        notifyCustomer: z.boolean().default(false),
        trackingNumber: z.string().min(1).max(255).optional(),
        trackingCompany: z.string().min(1).max(255).optional(),
        trackingUrl: z.url().optional(),
      },
      annotations: { destructiveHint: true },
    },
    guarded(async (input) => {
      if ((input.trackingCompany || input.trackingUrl) && !input.trackingNumber) {
        throw new Error("Provide trackingNumber when supplying tracking company or URL");
      }
      return result(await createFulfillment(client, input));
    }),
  );

  server.registerTool(
    "shopify_order_summary",
    {
      title: "Summarize Shopify orders",
      description: "Compute counts and current order totals from accessible non-test orders created in the UTC date range [from, toExclusive). Excludes cancelled orders from the amount. Not a native Shopify Analytics report or payment revenue. Check paginationComplete and the 60-day scope limit.",
      inputSchema: {
        from: date,
        toExclusive: date,
        maxPages: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    guarded(async (input) => result(await summarizeOrders(client, input))),
  );
}
