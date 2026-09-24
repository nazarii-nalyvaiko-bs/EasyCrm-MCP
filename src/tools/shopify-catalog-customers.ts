import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CredentialExchangeError } from "../shopify/auth/auth.js";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import { createCustomer, deleteCustomer, getCustomer, listCustomers, updateCustomer } from "../shopify/operations/customers.js";
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from "../shopify/operations/products.js";
import { listInventoryLocations, listProductVariants, listVariantInventory, setInventoryAvailable, updateVariantPrice } from "../shopify/operations/variants.js";

const productId = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/).describe("Shopify product GID");
const customerId = z.string().regex(/^gid:\/\/shopify\/Customer\/\d+$/).describe("Shopify customer GID");
const variantId = z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/).describe("Shopify variant GID");
const inventoryItemId = z.string().regex(/^gid:\/\/shopify\/InventoryItem\/\d+$/).describe("Shopify inventory item GID");
const locationId = z.string().regex(/^gid:\/\/shopify\/Location\/\d+$/).describe("Shopify location GID");
const pageInput = {
  first: z.number().int().min(1).max(100).default(20).describe("Number of records, maximum 100"),
  after: z.string().optional().describe("endCursor from the previous page"),
  query: z.string().optional().describe("Shopify search query, such as title:shirt or email:person@example.com"),
};
const productFields = {
  title: z.string().min(1).optional(),
  descriptionHtml: z.string().optional(),
  handle: z.string().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "DRAFT", "UNLISTED"]).optional(),
  vendor: z.string().optional(),
  productType: z.string().optional(),
  tags: z.array(z.string()).optional().describe("Full tag list. Replaces existing tags on update"),
};
const customerFields = {
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.email().optional(),
  phone: z.string().optional(),
  note: z.string().optional(),
  tags: z.array(z.string()).optional().describe("Full tag list. Replaces existing tags on update"),
};
const moneyAmount = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/).describe("Nonnegative amount in the shop currency, e.g. 19.99");

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorText(error: unknown): string {
  if (error instanceof CredentialExchangeError) {
    return `${error.message}. Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in the MCP configuration.`;
  }
  if (error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")) {
    return `${error.message}. Grant the required Shopify API scope and reinstall the app.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function guard<Input>(handler: (input: Input) => Promise<CallToolResult>) {
  return async (input: Input): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      return { content: [{ type: "text", text: errorText(error) }], isError: true };
    }
  };
}

function requireChanges(changes: Record<string, unknown>): void {
  if (Object.keys(changes).length === 0) throw new Error("Provide at least one field to update.");
}

export function registerShopifyCatalogCustomerTools(server: McpServer, client: ShopifyClient): void {
  server.registerTool("shopify_product_list", {
    title: "List Shopify products",
    description: "Search and page through Shopify products. Use pageInfo.endCursor as after for the next page. Requires read_products.",
    inputSchema: pageInput,
    annotations: { readOnlyHint: true },
  }, guard(async (input) => result(await listProducts(client, input))));

  server.registerTool("shopify_product_get", {
    title: "Get Shopify product",
    description: "Read one Shopify product by GID. Requires read_products.",
    inputSchema: { id: productId },
    annotations: { readOnlyHint: true },
  }, guard(async ({ id }) => result(await getProduct(client, id))));

  server.registerTool("shopify_product_create", {
    title: "Create Shopify product",
    description: "Create a Shopify product with core details. Variants and prices require separate operations. Requires write_products.",
    inputSchema: { ...productFields, title: z.string().min(1) },
  }, guard(async (input) => result(await createProduct(client, input))));

  server.registerTool("shopify_product_update", {
    title: "Update Shopify product",
    description: "Update core product details by GID. Only supplied fields change. Tags, when supplied, replace the current list. Requires write_products.",
    inputSchema: { id: productId, ...productFields },
  }, guard(async ({ id, ...changes }) => {
    requireChanges(changes);
    return result(await updateProduct(client, id, changes));
  }));

  server.registerTool("shopify_product_delete", {
    title: "Delete Shopify product",
    description: "Permanently delete one product by GID. Requires write_products.",
    inputSchema: { id: productId },
    annotations: { destructiveHint: true },
  }, guard(async ({ id }) => result(await deleteProduct(client, id))));

  server.registerTool("shopify_product_variant_list", {
    title: "List Shopify product variants",
    description: "List variants with prices, inventory item IDs, and aggregate inventory. Requires read_products.",
    inputSchema: { productId, first: pageInput.first, after: pageInput.after },
    annotations: { readOnlyHint: true },
  }, guard(async ({ productId, first, after }) => result(await listProductVariants(client, productId, first, after))));

  server.registerTool("shopify_product_variant_update_price", {
    title: "Update Shopify variant price",
    description: "Set the price of one existing variant. compareAtPrice is optional; pass null to clear it. Requires write_products.",
    inputSchema: {
      productId,
      variantId,
      price: moneyAmount,
      compareAtPrice: moneyAmount.nullable().optional(),
    },
  }, guard(async (input) => result(await updateVariantPrice(client, input))));

  server.registerTool("shopify_inventory_location_list", {
    title: "List Shopify inventory locations",
    description: "List active locations and their IDs for inventory operations. Requires read_locations or read_inventory.",
    inputSchema: { first: pageInput.first, after: pageInput.after },
    annotations: { readOnlyHint: true },
  }, guard(async ({ first, after }) => result(await listInventoryLocations(client, first, after))));

  server.registerTool("shopify_product_variant_inventory", {
    title: "Read Shopify variant inventory",
    description: "Read a variant's inventory item ID and available quantities by location. Requires read_inventory.",
    inputSchema: { variantId, first: pageInput.first, after: pageInput.after },
    annotations: { readOnlyHint: true },
  }, guard(async ({ variantId, first, after }) => result(await listVariantInventory(client, variantId, first, after))));

  server.registerTool("shopify_inventory_set_available", {
    title: "Set Shopify available inventory",
    description: "Set an inventory item's available quantity at one stocked location. Supply the current compareQuantity from a fresh inventory read and reuse the same idempotencyKey when retrying an uncertain request. Requires write_inventory.",
    inputSchema: {
      inventoryItemId,
      locationId,
      quantity: z.number().int(),
      compareQuantity: z.number().int(),
      idempotencyKey: z.uuid(),
    },
    annotations: { destructiveHint: true },
  }, guard(async (input) => result(await setInventoryAvailable(client, input))));

  server.registerTool("shopify_customer_list", {
    title: "List Shopify customers",
    description: "Search and page through customers, including personal contact information. Requires read_customers and protected customer data approval.",
    inputSchema: pageInput,
    annotations: { readOnlyHint: true },
  }, guard(async (input) => result(await listCustomers(client, input))));

  server.registerTool("shopify_customer_get", {
    title: "Get Shopify customer",
    description: "Read a customer by GID. Requires read_customers and protected customer data approval.",
    inputSchema: { id: customerId },
    annotations: { readOnlyHint: true },
  }, guard(async ({ id }) => result(await getCustomer(client, id))));

  server.registerTool("shopify_customer_create", {
    title: "Create Shopify customer",
    description: "Create a customer with contact and profile fields. Requires write_customers and protected customer data approval.",
    inputSchema: customerFields,
  }, guard(async (input) => {
    if (!input.email && !input.phone) throw new Error("Provide an email or phone to create a customer.");
    return result(await createCustomer(client, input));
  }));

  server.registerTool("shopify_customer_update", {
    title: "Update Shopify customer",
    description: "Update a customer by GID. Only supplied fields change. Tags, when supplied, replace the current list. Requires write_customers and protected customer data approval.",
    inputSchema: { id: customerId, ...customerFields },
  }, guard(async ({ id, ...changes }) => {
    requireChanges(changes);
    return result(await updateCustomer(client, id, changes));
  }));

  server.registerTool("shopify_customer_delete", {
    title: "Delete Shopify customer",
    description: "Delete a customer by GID. Shopify only permits deletion when the customer has no orders. Requires write_customers.",
    inputSchema: { id: customerId },
    annotations: { destructiveHint: true },
  }, guard(async ({ id }) => result(await deleteCustomer(client, id))));
}
