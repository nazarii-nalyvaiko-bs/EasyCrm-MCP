import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { HoroshopClient } from "../horoshop/client.js";
import { listProducts } from "../horoshop/products.js";

export function registerHoroshopTools(server: McpServer, client: HoroshopClient): void {
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
    async (input): Promise<CallToolResult> => {
      try {
        const products = await listProducts(client, input);
        return { content: [{ type: "text", text: JSON.stringify({ products, offset: input.offset, limit: input.limit }, null, 2) }] };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          isError: true,
        };
      }
    },
  );
}
