import type { ShopifyClient } from "../client.js";
import type { ThemeRole } from "./themes.js";
import { readThemeFile, updateThemeFile } from "./themes.js";

type MediaKind = "image_picker" | "video";
type JsonRecord = Record<string, unknown>;

export interface ThemeMediaSlot {
  sectionId: string | null;
  blockId: string | null;
  settingId: string;
  kind: MediaKind;
  label: string;
  currentValue: string | null;
}

export interface ThemeMediaLocation {
  themeId: string;
  filePath: string;
  sectionId?: string;
  blockId?: string;
  settingId: string;
}

export interface ThemeMediaUpdateInput extends ThemeMediaLocation {
  reference: string;
  expectedCurrentValue: string | null;
  expectedRole: ThemeRole;
  confirmLiveTheme?: boolean;
}

function record(value: unknown, context: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${context} must be a JSON object`);
  }
  return value as JsonRecord;
}

function parseJson(content: string, context: string): JsonRecord {
  try {
    return record(JSON.parse(content.slice(leadingComment(content).length)), context);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${context} is not valid JSON`);
    throw error;
  }
}

function leadingComment(content: string): string {
  return content.match(/^\s*\/\*[\s\S]*?\*\/\s*/)?.[0] ?? "";
}

function settingDefinitions(value: unknown): { id: string; type: MediaKind; label: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const setting = item as JsonRecord;
    if ((setting.type !== "image_picker" && setting.type !== "video") || typeof setting.id !== "string") return [];
    return [{ id: setting.id, type: setting.type, label: typeof setting.label === "string" ? setting.label : setting.id }];
  });
}

function currentValue(settings: JsonRecord, settingId: string): string | null {
  const value = settings[settingId];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error(`Media setting ${settingId} is not a string`);
  return value;
}

function sectionSchema(content: string, path: string): JsonRecord {
  const match = content.match(/{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/);
  if (!match) throw new Error(`No schema in ${path}`);
  return parseJson(match[1], `${path} schema`);
}

function settingsRoot(file: JsonRecord, filePath: string): JsonRecord {
  if (filePath === "config/settings_data.json") return record(file.current, "Current theme settings");
  return file;
}

function validateFilePath(filePath: string): void {
  if (filePath === "config/settings_data.json") return;
  if (/^templates\/[a-zA-Z0-9_./-]+\.json$/.test(filePath) && !filePath.includes("..")) return;
  if (/^sections\/[a-zA-Z0-9_-]+-group\.json$/.test(filePath)) return;
  throw new Error("Use a JSON template, section group, or config/settings_data.json");
}

async function inspect(
  client: ShopifyClient,
  themeId: string,
  filePath: string,
): Promise<ThemeMediaSlot[]> {
  validateFilePath(filePath);
  const document = parseJson(await readThemeFile(client, themeId, filePath), filePath);
  const root = settingsRoot(document, filePath);
  const slots: ThemeMediaSlot[] = [];
  if (filePath === "config/settings_data.json") {
    const schema = JSON.parse(await readThemeFile(client, themeId, "config/settings_schema.json")) as unknown;
    if (!Array.isArray(schema)) throw new Error("config/settings_schema.json must be an array");
    const globalSettings = record(root.settings, "Global theme settings");
    for (const group of schema) {
      if (!group || typeof group !== "object") continue;
      for (const setting of settingDefinitions((group as JsonRecord).settings)) {
        slots.push({ sectionId: null, blockId: null, settingId: setting.id, kind: setting.type, label: setting.label, currentValue: currentValue(globalSettings, setting.id) });
      }
    }
  }

  const sections = record(root.sections ?? (filePath === "config/settings_data.json" ? {} : undefined), "Theme sections");
  const schemaCache = new Map<string, JsonRecord>();
  for (const [sectionId, rawSection] of Object.entries(sections)) {
    const section = record(rawSection, `Section ${sectionId}`);
    if (typeof section.type !== "string" || !/^[a-zA-Z0-9_-]+$/.test(section.type)) continue;
    let schema = schemaCache.get(section.type);
    if (!schema) {
      const schemaPath = `sections/${section.type}.liquid`;
      schema = sectionSchema(await readThemeFile(client, themeId, schemaPath), schemaPath);
      schemaCache.set(section.type, schema);
    }
    const sectionSettings = record(section.settings ?? {}, `Settings for section ${sectionId}`);
    for (const setting of settingDefinitions(schema.settings)) {
      slots.push({ sectionId, blockId: null, settingId: setting.id, kind: setting.type, label: setting.label, currentValue: currentValue(sectionSettings, setting.id) });
    }
    if (!section.blocks) continue;
    for (const [blockId, rawBlock] of Object.entries(record(section.blocks, `Blocks of ${sectionId}`))) {
      const block = record(rawBlock, `Block ${blockId}`);
      const blockSchema = Array.isArray(schema.blocks)
        ? schema.blocks.find((candidate) => candidate && typeof candidate === "object" && (candidate as JsonRecord).type === block.type) as JsonRecord | undefined
        : undefined;
      if (!blockSchema) continue;
      const blockSettings = record(block.settings ?? {}, `Settings for block ${blockId}`);
      for (const setting of settingDefinitions(blockSchema.settings)) {
        slots.push({ sectionId, blockId, settingId: setting.id, kind: setting.type, label: setting.label, currentValue: currentValue(blockSettings, setting.id) });
      }
    }
  }
  return slots;
}

export async function listThemeMediaSlots(client: ShopifyClient, themeId: string, filePath: string): Promise<ThemeMediaSlot[]> {
  return inspect(client, themeId, filePath);
}

function findSlot(slots: ThemeMediaSlot[], location: ThemeMediaLocation): ThemeMediaSlot {
  const slot = slots.find((candidate) => candidate.sectionId === (location.sectionId ?? null)
    && candidate.blockId === (location.blockId ?? null)
    && candidate.settingId === location.settingId);
  if (!slot) throw new Error("Media setting was not found in the theme schema. Inspect slots before changing it.");
  return slot;
}

function settingsAt(document: JsonRecord, location: ThemeMediaLocation): JsonRecord {
  const root = settingsRoot(document, location.filePath);
  if (!location.sectionId) {
    if (location.filePath !== "config/settings_data.json" || location.blockId) throw new Error("A section ID is required here");
    return record(root.settings, "Global theme settings");
  }
  const sections = record(root.sections, "Theme sections");
  const section = record(sections[location.sectionId], `Section ${location.sectionId}`);
  if (!location.blockId) {
    if (!section.settings) section.settings = {};
    return record(section.settings, `Settings for section ${location.sectionId}`);
  }
  const blocks = record(section.blocks, `Blocks of section ${location.sectionId}`);
  const block = record(blocks[location.blockId], `Block ${location.blockId}`);
  if (!block.settings) block.settings = {};
  return record(block.settings, `Settings for block ${location.blockId}`);
}

export function referenceForMedia(kind: MediaKind, filename: string): string {
  if (!filename || filename.includes("/") || filename.includes("\\")) throw new Error("Invalid Shopify Files filename");
  return kind === "image_picker" ? `shopify://shop_images/${filename}` : `shopify://files/videos/${filename}`;
}

export async function updateThemeMediaSetting(
  client: ShopifyClient,
  input: ThemeMediaUpdateInput,
): Promise<{ reference: string; previousValue: string | null; filename: string; jobId: string | null }> {
  const slots = await inspect(client, input.themeId, input.filePath);
  const slot = findSlot(slots, input);
  const prefix = slot.kind === "image_picker" ? "shopify://shop_images/" : "shopify://files/videos/";
  if (!input.reference.startsWith(prefix)) throw new Error(`This ${slot.kind} setting requires a ${prefix} reference`);
  if (slot.currentValue !== input.expectedCurrentValue) {
    throw new Error(`Media setting changed: expected ${JSON.stringify(input.expectedCurrentValue)}, found ${JSON.stringify(slot.currentValue)}`);
  }

  const content = await readThemeFile(client, input.themeId, input.filePath);
  const document = parseJson(content, input.filePath);
  const settings = settingsAt(document, input);
  if (currentValue(settings, input.settingId) !== input.expectedCurrentValue) {
    throw new Error("Theme content changed while editing. Inspect the media setting again.");
  }
  settings[input.settingId] = input.reference;
  const updated = await updateThemeFile(client, {
    themeId: input.themeId,
    filePath: input.filePath,
    fileContent: leadingComment(content) + JSON.stringify(document, null, 2),
    expectedRole: input.expectedRole,
    confirmLiveTheme: input.confirmLiveTheme,
  });
  return { reference: input.reference, previousValue: input.expectedCurrentValue, ...updated };
}
