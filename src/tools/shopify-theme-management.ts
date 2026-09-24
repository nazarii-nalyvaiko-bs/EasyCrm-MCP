import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import {
  createUnpublishedTheme,
  duplicateUnpublishedTheme,
  getActiveTheme,
  publishTheme,
} from "../shopify/operations/theme-management.js";

const themeId = z.string().startsWith("gid://shopify/OnlineStoreTheme/");
const themeName = z.string().trim().min(1).max(255);

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function guarded<Input>(handler: (input: Input) => Promise<unknown>) {
  return async (input: Input): Promise<CallToolResult> => {
    try {
      return result(await handler(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const permissionHint = error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")
        ? " Check read_themes or write_themes and Shopify's theme API exemption."
        : "";
      return { content: [{ type: "text", text: `${message}${permissionHint}` }], isError: true };
    }
  };
}

export function registerShopifyThemeManagementTools(server: McpServer, shopify: ShopifyClient): void {
  server.registerTool(
    "shopify_theme_active",
    {
      title: "Get active Shopify theme",
      description: "Read the exact ID, name, and role of the current live MAIN theme before making theme changes.",
      annotations: { readOnlyHint: true },
    },
    guarded(async () => getActiveTheme(shopify)),
  );

  server.registerTool(
    "shopify_theme_import_draft",
    {
      title: "Import unpublished Shopify theme",
      description: "Import a theme ZIP from a public HTTPS URL as an UNPUBLISHED theme. The live theme is not changed. Requires write_themes and Shopify theme API exemption.",
      inputSchema: {
        source: z.string().url().startsWith("https://").describe("Public HTTPS URL for a theme ZIP or a Shopify staged upload URL"),
        name: themeName.describe("Name of the new unpublished theme"),
      },
    },
    guarded(async (input) => createUnpublishedTheme(shopify, input.source, input.name)),
  );

  server.registerTool(
    "shopify_theme_duplicate_draft",
    {
      title: "Duplicate Shopify theme as draft",
      description: "Duplicate an existing theme into a new UNPUBLISHED theme for safe editing. Check shopify_theme_active first when duplicating the live theme. Requires write_themes and Shopify theme API exemption.",
      inputSchema: {
        sourceThemeId: themeId.describe("ID of the theme to copy, from shopify_theme_list or shopify_theme_active"),
        name: themeName.optional().describe("Optional name for the new draft theme"),
      },
    },
    guarded(async (input) => duplicateUnpublishedTheme(shopify, input.sourceThemeId, input.name)),
  );

  server.registerTool(
    "shopify_theme_publish",
    {
      title: "Publish Shopify theme",
      description: "Make an existing theme live. First read shopify_theme_active and obtain the user's explicit approval for the target theme. Supply the current MAIN theme ID as expectedCurrentMainThemeId; publishing fails if it changed.",
      inputSchema: {
        themeId: themeId.describe("Exact ID of the theme to publish"),
        expectedCurrentMainThemeId: themeId.describe("Exact live MAIN theme ID returned by shopify_theme_active before approval"),
        confirmPublish: z.literal(true).describe("Set to true only after the user explicitly approves publishing this theme and replacing the current MAIN theme"),
      },
      annotations: { destructiveHint: true },
    },
    guarded(async (input) => publishTheme(shopify, input.themeId, input.expectedCurrentMainThemeId)),
  );
}
