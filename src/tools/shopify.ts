import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { CredentialExchangeError } from "../shopify/auth/auth.js";
import type { ShopifyClient } from "../shopify/client.js";
import { ShopifyGraphqlError } from "../shopify/errors.js";
import { fetchShopInfo } from "../shopify/operations/shop.js";
import { createPage, listPages, updatePage } from "../shopify/operations/pages.js";
import { listMenus, updateMenu } from "../shopify/operations/menus.js";
import { listThemes, readThemeFile, updateThemeFile } from "../shopify/operations/themes.js";

const MAX_THEME_FILE_BYTES = 1_000_000;

const themeFileLocationInput = {
  themeId: z
    .string()
    .startsWith("gid://shopify/OnlineStoreTheme/")
    .describe("Theme GID, e.g. gid://shopify/OnlineStoreTheme/123456789"),
  filePath: z
    .string()
    .max(255)
    .describe("Path inside the theme, e.g. sections/header.liquid or templates/index.json"),
};

const updateThemeFileInput = {
  ...themeFileLocationInput,
  expectedRole: z.enum(["ARCHIVED", "DEMO", "DEVELOPMENT", "LOCKED", "MAIN", "MOBILE", "UNPUBLISHED"])
    .describe("Role observed from a fresh shopify_theme_list or shopify_theme_active call. The update fails if it changed."),
  confirmLiveTheme: z.boolean().default(false)
    .describe("Set true only after the user explicitly approves editing the active MAIN theme."),
  fileContent: z
    .string()
    .max(MAX_THEME_FILE_BYTES)
    .describe("Full new file content — replaces the file entirely"),
};

const pageCreateInput = {
  title: z.string().min(1).describe("Page title shown in the storefront"),
  body: z.string().optional().describe("Page content as HTML"),
  handle: z
    .string()
    .optional()
    .describe("URL slug, e.g. about-us — derived from title if omitted"),
  isPublished: z
    .boolean()
    .default(false)
    .describe("false keeps the page as an unpublished draft"),
};

const pageUpdateInput = {
  id: z.string().startsWith("gid://shopify/Page/").describe("Page GID from shopify_page_list"),
  title: z.string().optional().describe("New page title"),
  body: z.string().optional().describe("New page content as HTML"),
  handle: z.string().optional().describe("New URL slug"),
  isPublished: z
    .boolean()
    .optional()
    .describe("true publishes the page, false unpublishes it — omit to leave unchanged"),
};

const menuItemInput = z.object({
  id: z.string().optional().describe("Menu item GID — include to keep an existing item, omit for new"),
  title: z.string().describe("Menu item title"),
  type: z
    .enum([
      "HTTP",
      "PAGE",
      "COLLECTION",
      "PRODUCT",
      "BLOG",
      "ARTICLE",
      "FRONTPAGE",
      "CATALOG",
      "SEARCH",
      "SHOP_POLICY",
      "METAOBJECT",
      "CUSTOMER_ACCOUNT_PAGE",
    ])
    .describe("HTTP = plain url link; most others link a Shopify resource via resourceId"),
  url: z.string().optional().describe("URL, required when type is HTTP, e.g. /pages/contact"),
  resourceId: z.string().optional().describe("Resource GID, required for PAGE/COLLECTION/PRODUCT/BLOG"),
});

const menuUpdateInput = {
  menuId: z.string().startsWith("gid://shopify/Menu/").describe("Menu GID from shopify_menu_list"),
  title: z.string().describe("Menu title (required by Shopify even if unchanged)"),
  items: z
    .array(menuItemInput.extend({
      items: z.array(menuItemInput).optional().describe("Sub-menu (dropdown) items"),
    }))
    .describe("The FULL menu — REPLACES all existing items. Include every item you want to keep, with their ids."),
};

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value: unknown): CallToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

function toolErrorText(error: unknown): string {
  if (error instanceof CredentialExchangeError) {
    return `${error.message}. Ask the user to verify SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET in their MCP configuration.`;
  }
  if (error instanceof ShopifyGraphqlError && error.codes.includes("ACCESS_DENIED")) {
    return `${error.message} The app is missing an API scope — ask the user to grant it in the Shopify Dev Dashboard and reinstall the app.`;
  }
  return error instanceof Error ? error.message : String(error);
}

function guard<Input>(handler: (input: Input) => Promise<CallToolResult>) {
  return async (input: Input): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      return { ...textResult(toolErrorText(error)), isError: true };
    }
  };
}

export function registerShopTools(server: McpServer, shopify: ShopifyClient): void {
  server.registerTool(
    "shopify_get_info",
    {
      title: "Get shop info",
      description:
        "Get basic info about the connected Shopify store: name, domain, currency, plan.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => jsonResult(await fetchShopInfo(shopify))),
  );

  server.registerTool(
    "shopify_theme_list",
    {
      title: "List themes",
      description:
        "List the store's themes with their GIDs and roles. Role MAIN is the published live theme. Use the id from here for shopify_theme_read_file and shopify_theme_update_file.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => jsonResult(await listThemes(shopify))),
  );

  server.registerTool(
    "shopify_theme_read_file",
    {
      title: "Read theme file",
      description:
        "Read the content of one file in a Shopify theme. Get the theme ID from shopify_theme_list first.",
      inputSchema: themeFileLocationInput,
      annotations: { readOnlyHint: true },
    },
    guard(async (input) => textResult(await readThemeFile(shopify, input.themeId, input.filePath))),
  );

  server.registerTool(
    "shopify_theme_update_file",
    {
      title: "Update theme file",
      description:
        "Overwrite one file in a Shopify theme. First read the current theme role and show the user which theme is active. If the target is MAIN, ask the user for explicit approval before setting confirmLiveTheme=true. An unexpected role change stops the update.",
      inputSchema: updateThemeFileInput,
      annotations: { destructiveHint: true },
    },
    guard(async (input) => jsonResult(await updateThemeFile(shopify, input))),
  );

  server.registerTool(
    "shopify_page_list",
    {
      title: "List pages",
      description:
        "List the store's pages with their GIDs, handles, and publish status. Use the id from here for shopify_page_update.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => jsonResult(await listPages(shopify))),
  );

  server.registerTool(
    "shopify_page_create",
    {
      title: "Create page",
      description:
        "Create a new page in the Shopify store. Pages are created as unpublished drafts unless isPublished is true.",
      inputSchema: pageCreateInput,
    },
    guard(async (input) => jsonResult(await createPage(shopify, input))),
  );

  server.registerTool(
    "shopify_page_update",
    {
      title: "Update page",
      description:
        "Update an existing page's title, body, handle, or publish status. Only provided fields change. Get the page GID from shopify_page_list.",
      inputSchema: pageUpdateInput,
      annotations: { destructiveHint: true },
    },
    guard(async ({ id, ...page }) => jsonResult(await updatePage(shopify, id, page))),
  );

  server.registerTool(
    "shopify_menu_list",
    {
      title: "List menus",
      description:
        "List the store's navigation menus with their GIDs, handles, and items. Themes reference menus by handle (e.g. main-menu, footer). Use the id and current items from here for shopify_menu_update.",
      annotations: { readOnlyHint: true },
    },
    guard(async () => jsonResult(await listMenus(shopify))),
  );

  server.registerTool(
    "shopify_menu_update",
    {
      title: "Update menu",
      description:
        "Replace a menu's items in the Shopify store. Items not included are DELETED from the menu, so get the current items from shopify_menu_list first and include every item you want to keep, with their ids.",
      inputSchema: menuUpdateInput,
      annotations: { destructiveHint: true },
    },
    guard(async (input) => jsonResult(await updateMenu(shopify, input.menuId, input.title, input.items))),
  );
}
