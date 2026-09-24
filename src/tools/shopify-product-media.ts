import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CredentialExchangeError } from "../shopify/auth/auth.js";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import { addLocalProductImage } from "../shopify/operations/local-product-media.js";
import { addProductImages, createDraftProductWithImages, listProductMedia } from "../shopify/operations/product-media.js";

const productId = z.string().regex(/^gid:\/\/shopify\/Product\/\d+$/).describe("Shopify product GID");
const imageSource = z.object({
  url: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  }, "Use a public HTTPS image URL without credentials"),
  alt: z.string().optional(),
});
const images = z.array(imageSource).min(1).max(20)
  .describe("Public HTTPS image URLs that Shopify can fetch; processing continues asynchronously");
const moneyAmount = z.string().regex(/^(0|[1-9]\d*)(\.\d+)?$/)
  .describe("Nonnegative amount in the shop currency, for example 19.99");

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function errorResult(error: unknown): CallToolResult {
  let message = error instanceof Error ? error.message : String(error);
  if (error instanceof CredentialExchangeError) {
    message += ". Check SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in the MCP configuration.";
  } else if (error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")) {
    message += ". Grant the required Shopify API scope and reinstall the app.";
  }
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerShopifyProductMediaTools(server: McpServer, client: ShopifyClient): void {
  server.registerTool("shopify_product_create_draft_with_images", {
    title: "Create Shopify draft product with images",
    description: "Create a DRAFT product and submit public HTTPS images in one Shopify mutation. Image processing is asynchronous. Optionally set the initial variant price in a second call; a failed price step is returned as a partial result with the created product ID. Requires write_products.",
    inputSchema: {
      title: z.string().min(1),
      descriptionHtml: z.string().optional(),
      handle: z.string().optional(),
      vendor: z.string().optional(),
      productType: z.string().optional(),
      tags: z.array(z.string()).optional(),
      images,
      price: moneyAmount.optional(),
      compareAtPrice: moneyAmount.nullable().optional(),
    },
  }, async (input): Promise<CallToolResult> => {
    try {
      const outcome = await createDraftProductWithImages(client, input);
      return { ...result(outcome), ...(outcome.priceUpdate.status === "failed" ? { isError: true } : {}) };
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("shopify_product_image_add", {
    title: "Add images to Shopify product",
    description: "Submit public HTTPS images to an existing product. Use shopify_product_media_list to check processing status. Requires write_products.",
    inputSchema: { productId, images },
  }, async ({ productId: id, images: sources }): Promise<CallToolResult> => {
    try {
      return result(await addProductImages(client, id, sources));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("shopify_product_image_add_local", {
    title: "Add a local image to a Shopify product",
    description: "Read one local PNG, JPEG, WebP, or GIF (up to 20 MB), upload it to Shopify staging, and attach it to an existing product. Use shopify_product_media_list to check processing status. Requires write_products; Shopify may also require write_files for media uploads.",
    inputSchema: {
      productId,
      filePath: z.string().min(1).describe("Absolute path to an image on the MCP server's machine"),
      alt: z.string().optional(),
    },
  }, async ({ productId: id, filePath, alt }): Promise<CallToolResult> => {
    try {
      return result(await addLocalProductImage(client, id, filePath, alt));
    } catch (error) {
      return errorResult(error);
    }
  });

  server.registerTool("shopify_product_media_list", {
    title: "List Shopify product media",
    description: "Read image processing status, errors, and CDN URLs when ready. Page with endCursor. Requires read_products.",
    inputSchema: {
      productId,
      first: z.number().int().min(1).max(100).default(20),
      after: z.string().optional(),
    },
    annotations: { readOnlyHint: true },
  }, async ({ productId: id, first, after }): Promise<CallToolResult> => {
    try {
      return result(await listProductMedia(client, id, first, after));
    } catch (error) {
      return errorResult(error);
    }
  });
}
