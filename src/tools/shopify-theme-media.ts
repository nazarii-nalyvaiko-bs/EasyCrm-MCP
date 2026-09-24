import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ShopifyClient } from "../shopify/client.js";
import { getThemeMediaFile, uploadLocalThemeMedia } from "../shopify/operations/theme-files.js";
import { listThemeMediaSlots, updateThemeMediaSetting } from "../shopify/operations/theme-media.js";

const themeId = z.string().regex(/^gid:\/\/shopify\/OnlineStoreTheme\/\d+$/);
const filePath = z.string().min(1).max(255)
  .describe("JSON template, section group, or config/settings_data.json, for example templates/index.json");
const kind = z.enum(["image_picker", "video"]);
const fileId = z.string().regex(/^gid:\/\/shopify\/(MediaImage|Video)\/\d+$/);
const role = z.enum(["ARCHIVED", "DEMO", "DEVELOPMENT", "LOCKED", "MAIN", "MOBILE", "UNPUBLISHED"]);

function result(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function guarded<Input>(handler: (input: Input) => Promise<CallToolResult>) {
  return async (input: Input): Promise<CallToolResult> => {
    try {
      return await handler(input);
    } catch (error) {
      return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
    }
  };
}

export function registerShopifyThemeMediaTools(server: McpServer, client: ShopifyClient): void {
  server.registerTool("shopify_theme_media_slots", {
    title: "Inspect Shopify theme media settings",
    description: "List image and video picker settings in one JSON template, section group, or global theme settings file. Includes empty slots, section and block IDs, and current values. Requires read_themes.",
    inputSchema: { themeId, filePath },
    annotations: { readOnlyHint: true },
  }, guarded(async ({ themeId: id, filePath: path }) => result(await listThemeMediaSlots(client, id, path))));

  server.registerTool("shopify_theme_media_upload_local", {
    title: "Upload local image or video to Shopify Files",
    description: "Upload an absolute local PNG, JPEG, WebP, GIF, or MP4 path to Shopify Files for a theme picker. Returns a file ID and processing status. Use shopify_theme_media_file_status until READY before selecting it in a theme. Requires write_files or equivalent file permissions.",
    inputSchema: { filePath: z.string().min(1).describe("Absolute path on the machine running this MCP server"), kind },
  }, guarded(async ({ filePath: path, kind: mediaKind }) => result(await uploadLocalThemeMedia(client, path, mediaKind))));

  server.registerTool("shopify_theme_media_file_status", {
    title: "Check Shopify theme media file",
    description: "Check whether an uploaded Shopify Files image or video is READY and obtain its theme reference. Requires read_files or equivalent file permissions.",
    inputSchema: { fileId, kind },
    annotations: { readOnlyHint: true },
  }, guarded(async ({ fileId: id, kind: mediaKind }) => result(await getThemeMediaFile(client, id, mediaKind))));

  server.registerTool("shopify_theme_media_set", {
    title: "Set media in a Shopify theme section",
    description: "Replace or fill one image/video picker setting with a READY Shopify Files item. Inspect slots first and supply its exact section, block and setting IDs plus observed value. Before modifying MAIN, tell the user which theme is live and obtain explicit approval. Requires write_themes and Shopify's theme file exemption.",
    inputSchema: {
      themeId,
      filePath,
      sectionId: z.string().optional().describe("Section instance ID from shopify_theme_media_slots; omit for global settings"),
      blockId: z.string().optional().describe("Block instance ID from shopify_theme_media_slots"),
      settingId: z.string().min(1).describe("Media setting ID from shopify_theme_media_slots"),
      fileId,
      kind,
      expectedCurrentValue: z.string().nullable().describe("Current value from shopify_theme_media_slots, or null for an empty slot"),
      expectedRole: role.describe("Theme role from a fresh theme list or active-theme check"),
      confirmLiveTheme: z.boolean().default(false).describe("True only after explicit user approval to edit the live MAIN theme"),
    },
    annotations: { destructiveHint: true },
  }, guarded(async ({ fileId: id, kind: mediaKind, ...location }) => {
    const file = await getThemeMediaFile(client, id, mediaKind);
    if (file.status !== "READY" || !file.reference) {
      throw new Error(`Shopify File ${id} is ${file.status}. Wait until it is READY before editing the theme.`);
    }
    return result(await updateThemeMediaSetting(client, { ...location, reference: file.reference }));
  }));
}
