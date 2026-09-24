import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import { getSalesReport } from "../shopify/operations/analytics.js";

export function registerShopifyAnalyticsTools(server: McpServer, shopify: ShopifyClient): void {
  server.registerTool(
    "shopify_sales_report",
    {
      title: "Shopify sales report",
      description: "Read a native Shopify Analytics sales report for an inclusive date range. Select total, daily, or monthly results and fixed sales metrics. Requires read_reports and Shopify protected customer data access. Series results may be truncated at the row limit.",
      inputSchema: {
        from: z.iso.date().describe("Inclusive start date, YYYY-MM-DD"),
        to: z.iso.date().describe("Inclusive end date, YYYY-MM-DD"),
        interval: z.enum(["total", "day", "month"]).default("total"),
        metrics: z.array(z.enum([
          "total_sales", "orders", "gross_sales", "discounts", "net_sales", "average_order_value",
        ])).min(1).max(6).default(["total_sales", "orders"]),
        limit: z.number().int().min(1).max(1000).optional()
          .describe("Maximum daily or monthly rows, default 1000; not valid for total"),
      },
      annotations: { readOnlyHint: true },
    },
    async (input): Promise<CallToolResult> => {
      try {
        const report = await getSalesReport(shopify, input);
        return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const scopeHint = error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")
          ? " Check read_reports and protected customer data access in the Shopify app configuration."
          : "";
        return { content: [{ type: "text", text: `${message}${scopeHint}` }], isError: true };
      }
    },
  );
}
