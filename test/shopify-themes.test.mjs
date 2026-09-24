import assert from "node:assert/strict";
import { test } from "node:test";
import { updateThemeFile } from "../dist/shopify/operations/themes.js";

test("theme update requires a returned file or background job", async () => {
  const input = { themeId: "gid://shopify/OnlineStoreTheme/1", filePath: "templates/index.json", fileContent: "{}" };
  const client = { async query() {
    return { themeFilesUpsert: { upsertedThemeFiles: [], job: null, userErrors: [] } };
  } };
  await assert.rejects(updateThemeFile(client, input), /did not confirm/);
});
