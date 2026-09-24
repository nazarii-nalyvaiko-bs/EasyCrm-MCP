import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { listCategories } from "../horoshop/categories.js";
import type { HoroshopClient } from "../horoshop/client.js";
import { upsertCustomer } from "../horoshop/customers.js";
import { listOrders, listOrderStatuses, summarizeOrders, updateOrder } from "../horoshop/orders.js";
import { getPurchaseHistory } from "../horoshop/purchase-history.js";
import { createProduct, listProducts, updateProduct } from "../horoshop/products.js";
import { getProductReviews } from "../horoshop/reviews.js";

const date = z.iso.date();
const imageUrls = z.array(z.url().refine((value) => /^https?:\/\//.test(value), "Use an HTTP or HTTPS image URL")).min(1);
const imageUpdate = z.object({
  links: imageUrls,
  mode: z.enum(["append", "replace"]).describe("append keeps existing images; replace removes the gallery's existing images before import"),
});

async function resultOf(operation: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return { content: [{ type: "text", text: JSON.stringify(await operation(), null, 2) }] };
  } catch (error) {
    return {
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }
}

export function registerHoroshopTools(server: McpServer, client: HoroshopClient): void {
  server.registerTool(
    "horoshop_customer_purchase_history",
    {
      title: "Read Horoshop customer purchase history",
      description: "Find orders by exact delivery email in bounded pages of Horoshop orders. Includes purchased products. Use complete and nextOffset to continue scanning; an empty result is not a complete history when complete=false. Optional dates narrow the scan.",
      inputSchema: {
        email: z.email(),
        offset: z.number().int().min(0).default(0),
        maxPages: z.number().int().min(1).max(10).default(5),
        from: date.optional(),
        to: date.optional(),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => resultOf(async () => {
      if (input.from && input.to && input.from > input.to) throw new Error("from must be on or before to");
      return getPurchaseHistory(client, input);
    }),
  );

  server.registerTool(
    "horoshop_category_list",
    {
      title: "List Horoshop categories",
      description: "Read child catalog categories under a parent category. Use parent=0 for root categories. Requires Horoshop 4 or later.",
      inputSchema: { parent: z.number().int().min(0).default(0) },
      annotations: { readOnlyHint: true },
    },
    (input) => resultOf(async () => ({ categories: await listCategories(client, input.parent) })),
  );

  server.registerTool(
    "horoshop_customer_upsert",
    {
      title: "Create or update a Horoshop customer",
      description: "Import one customer by unique email. An existing customer with that email may be updated. Only supplied profile fields are sent.",
      inputSchema: {
        name: z.string().min(1),
        email: z.email(),
        phone: z.string().min(1).optional(),
        note: z.string().optional(),
      },
      annotations: { destructiveHint: true },
    },
    (input) => resultOf(() => upsertCustomer(client, input)),
  );

  server.registerTool(
    "horoshop_product_list",
    {
      title: "List Horoshop products",
      description: "Read one page of products from the configured Horoshop store. Filter by article (SKU) or use offset and limit to page through the catalog. This never reads or changes the Shopify store.",
      inputSchema: {
        article: z.string().min(1).optional().describe("Horoshop article (SKU) to search for"),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(500).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => resultOf(async () => ({ products: await listProducts(client, input), offset: input.offset, limit: input.limit })),
  );

  server.registerTool(
    "horoshop_product_reviews",
    {
      title: "Read Horoshop product reviews",
      description: "Read public reviews from a product page on the configured Horoshop store. Accepts a product URL or path. Loads additional review batches when needed. totalCount comes from the page's structured data; complete=false means the returned reviews may not be the full set. A locally installed Chrome browser is needed when the page requires JavaScript or has more review batches.",
      inputSchema: {
        productUrl: z.string().min(1),
        maxReviews: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => resultOf(() => getProductReviews(client.storeOrigin, input.productUrl, input.maxReviews)),
  );

  server.registerTool(
    "horoshop_product_create",
    {
      title: "Create a Horoshop product",
      description: "Create a product with a unique article, title, and category ID. Use horoshop_category_list to find the category. Optional image URLs are fetched by Horoshop in order; each source image must be at most 5 MB. Variant images and the shared gallery are separate.",
      inputSchema: {
        article: z.string().min(1),
        title: z.string().min(1),
        categoryId: z.number().int().positive(),
        price: z.number().nonnegative().optional(),
        description: z.string().optional(),
        visible: z.boolean().optional(),
        variantImageUrls: imageUrls.optional(),
        commonGalleryImageUrls: imageUrls.optional(),
      },
    },
    (input) => resultOf(() => createProduct(client, input)),
  );

  server.registerTool(
    "horoshop_product_update",
    {
      title: "Update a Horoshop product",
      description: "Update an existing Horoshop product by exact article. Only supplied fields are sent. Image mode append preserves existing images; replace removes existing images in that gallery before importing the supplied URLs. Horoshop fetches image URLs in order and each source image must be at most 5 MB. Stock requires warehouse accounting enabled in Horoshop.",
      inputSchema: {
        article: z.string().min(1),
        price: z.number().nonnegative().optional(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        visible: z.boolean().optional(),
        stock: z.object({ warehouse: z.string().min(1), quantity: z.number().int().nonnegative() }).optional(),
        variantImages: imageUpdate.optional(),
        commonGallery: imageUpdate.optional(),
      },
      annotations: { destructiveHint: true },
    },
    (input) => resultOf(() => updateProduct(client, input)),
  );

  server.registerTool(
    "horoshop_order_list",
    {
      title: "List Horoshop orders",
      description: "Read a page of Horoshop orders. Results can include customer and delivery data.",
      inputSchema: {
        from: date.optional(),
        to: date.optional(),
        status: z.number().int().optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    (input) => resultOf(async () => {
      if (input.from && input.to && input.from > input.to) throw new Error("from must be on or before to");
      return { orders: await listOrders(client, input), offset: input.offset, limit: input.limit };
    }),
  );

  server.registerTool(
    "horoshop_order_statuses",
    {
      title: "List Horoshop order statuses",
      description: "Read the status IDs configured for the Horoshop store.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => resultOf(async () => ({ statuses: await listOrderStatuses(client) })),
  );

  server.registerTool(
    "horoshop_order_update",
    {
      title: "Update a Horoshop order",
      description: "Update one order's status or payment flag. Use horoshop_order_statuses to identify a valid status ID.",
      inputSchema: {
        orderId: z.number().int().positive(),
        status: z.number().int().positive().optional(),
        paid: z.boolean().optional(),
      },
      annotations: { destructiveHint: true },
    },
    (input) => resultOf(async () => {
      if (input.status !== undefined) {
        const statuses = await listOrderStatuses(client);
        if (!statuses.some((status) => status.id === input.status)) throw new Error("Status is not available in this Horoshop store");
      }
      return updateOrder(client, input);
    }),
  );

  server.registerTool(
    "horoshop_order_summary",
    {
      title: "Summarize Horoshop orders",
      description: "Calculate order counts, paid counts, order value by currency, status counts, and UTM source counts from orders in a date range. This is derived from orders, not a native analytics report. At most 5,000 orders are scanned; complete=false means more may exist. Order totals include discounts but exclude shipping.",
      inputSchema: { from: date, to: date },
      annotations: { readOnlyHint: true },
    },
    (input) => resultOf(async () => {
      if (input.from > input.to) throw new Error("from must be on or before to");
      return summarizeOrders(client, input.from, input.to);
    }),
  );
}
