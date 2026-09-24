import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import {
  createAutomaticDiscount,
  createPercentageCodeDiscount,
  deleteAutomaticDiscount,
  deleteCodeDiscount,
  listAutomaticDiscounts,
  listCodeDiscounts,
  updateAutomaticDiscount,
  updateCodeDiscount,
} from "../shopify/operations/discounts.js";

const discountId = z.string().startsWith("gid://shopify/DiscountCodeNode/");
const automaticDiscountId = z.string().startsWith("gid://shopify/DiscountAutomaticNode/");
const dateTime = z.iso.datetime({ offset: true });
const pageInput = {
  first: z.number().int().min(1).max(100).default(20),
  after: z.string().optional(),
};

const createInput = {
  title: z.string().min(1).describe("Discount title"),
  code: z.string().min(1).describe("Code entered at checkout"),
  startsAt: dateTime.describe("Start date and time with timezone"),
  endsAt: dateTime.nullable().optional().describe("Expiration, or null for no expiration"),
  percentage: z.number().gt(0).max(100).describe("Percent off all products, from 0 to 100"),
  usageLimit: z.number().int().positive().nullable().optional(),
  appliesOncePerCustomer: z.boolean().optional(),
};

const updateInput = {
  id: discountId.describe("Code discount ID from shopify_discount_code_list"),
  title: z.string().min(1).optional(),
  startsAt: dateTime.optional(),
  endsAt: dateTime.nullable().optional(),
  usageLimit: z.number().int().positive().nullable().optional(),
  appliesOncePerCustomer: z.boolean().optional(),
};

const automaticCreateInput = {
  title: z.string().min(1),
  startsAt: dateTime.describe("Start date and time with timezone"),
  endsAt: dateTime.nullable().optional(),
  value: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("percentage"), percentage: z.number().gt(0).max(100) }),
    z.object({
      kind: z.literal("fixedAmount"),
      amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/).refine((amount) => Number(amount) > 0),
    }),
  ]).describe("Percent off or fixed amount off the order in store currency"),
};

const automaticUpdateInput = {
  id: automaticDiscountId.describe("Automatic discount ID from shopify_discount_automatic_list"),
  title: z.string().min(1).optional(),
  startsAt: dateTime.optional(),
  endsAt: dateTime.nullable().optional(),
};

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorMessage(error: unknown): string {
  if (error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")) {
    return `${error.message}. Grant read_discounts or write_discounts to the Shopify app and reinstall it.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function guard<T>(handler: (input: T) => Promise<CallToolResult>) {
  return async (input: T): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      return { content: [{ type: "text", text: errorMessage(error) }], isError: true };
    }
  };
}

export function registerShopifyDiscountTools(server: McpServer, client: ShopifyClient): void {
  server.registerTool(
    "shopify_discount_code_list",
    {
      title: "List code discounts",
      description:
        "List one page of Shopify code discounts. Basic amount off discounts include title, status and up to 10 codes. Other code discount types return their type and ID. Pass endCursor as after for the next page.",
      inputSchema: pageInput,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ first, after }) => result(await listCodeDiscounts(client, first, after))),
  );

  server.registerTool(
    "shopify_discount_code_create",
    {
      title: "Create percentage code discount",
      description:
        "Create a percentage code discount for all products and all buyers. A future startsAt keeps it scheduled until that time.",
      inputSchema: createInput,
    },
    guard(async (input) => result(await createPercentageCodeDiscount(client, input))),
  );

  server.registerTool(
    "shopify_discount_code_update",
    {
      title: "Update basic code discount",
      description:
        "Update selected title, dates or usage limits of a basic amount off code discount. Omitted fields are preserved.",
      inputSchema: updateInput,
      annotations: { destructiveHint: true },
    },
    guard(async ({ id, ...input }) => result(await updateCodeDiscount(client, id, input))),
  );

  server.registerTool(
    "shopify_discount_code_delete",
    {
      title: "Delete code discount",
      description:
        "Permanently delete a code discount by ID. Customers will no longer be able to use its codes.",
      inputSchema: { id: discountId },
      annotations: { destructiveHint: true },
    },
    guard(async ({ id }) => result(await deleteCodeDiscount(client, id))),
  );

  server.registerTool(
    "shopify_discount_automatic_list",
    {
      title: "List automatic discounts",
      description:
        "List one page of automatic discounts. Basic amount off discounts include title, status and dates. Other types return their type and ID. Pass endCursor as after for the next page.",
      inputSchema: pageInput,
      annotations: { readOnlyHint: true },
    },
    guard(async ({ first, after }) => result(await listAutomaticDiscounts(client, first, after))),
  );

  server.registerTool(
    "shopify_discount_automatic_create",
    {
      title: "Create automatic amount off discount",
      description:
        "Create an automatic percentage or fixed amount discount for all products and all buyers. Fixed amount is in the store currency and applies once to the order.",
      inputSchema: automaticCreateInput,
    },
    guard(async (input) => result(await createAutomaticDiscount(client, input))),
  );

  server.registerTool(
    "shopify_discount_automatic_update",
    {
      title: "Update basic automatic discount",
      description:
        "Update selected title or dates of a basic amount off automatic discount. Omitted fields are preserved.",
      inputSchema: automaticUpdateInput,
      annotations: { destructiveHint: true },
    },
    guard(async ({ id, ...input }) => result(await updateAutomaticDiscount(client, id, input))),
  );

  server.registerTool(
    "shopify_discount_automatic_delete",
    {
      title: "Delete automatic discount",
      description: "Permanently delete an automatic discount by ID.",
      inputSchema: { id: automaticDiscountId },
      annotations: { destructiveHint: true },
    },
    guard(async ({ id }) => result(await deleteAutomaticDiscount(client, id))),
  );
}
