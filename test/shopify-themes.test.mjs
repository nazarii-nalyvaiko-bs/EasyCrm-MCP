import assert from "node:assert/strict";
import { test } from "node:test";
import { updateThemeFile } from "../dist/shopify/operations/themes.js";

test("theme update requires a returned file or background job", async () => {
  const input = { themeId: "gid://shopify/OnlineStoreTheme/1", filePath: "templates/index.json", fileContent: "{}", expectedRole: "UNPUBLISHED" };
  const client = { async query(document) {
    return document.includes("ThemeRoleBeforeUpdate")
      ? { theme: { id: input.themeId, name: "Draft", role: "UNPUBLISHED" } }
      : { themeFilesUpsert: { upsertedThemeFiles: [], job: null, userErrors: [] } };
  } };
  await assert.rejects(updateThemeFile(client, input), /did not confirm/);
});

test("theme update refuses a live theme without explicit confirmation", async () => {
  let mutations = 0;
  const client = { async query(document) {
    if (document.includes("ThemeRoleBeforeUpdate")) {
      return { theme: { id: "gid://shopify/OnlineStoreTheme/1", name: "Current", role: "MAIN" } };
    }
    mutations += 1;
    return { themeFilesUpsert: { upsertedThemeFiles: [{ filename: "templates/index.json" }], job: null, userErrors: [] } };
  } };
  const input = { themeId: "gid://shopify/OnlineStoreTheme/1", filePath: "templates/index.json", fileContent: "{}", expectedRole: "MAIN" };
  await assert.rejects(updateThemeFile(client, input), /Ask the user/);
  assert.equal(mutations, 0);
  assert.deepEqual(await updateThemeFile(client, { ...input, confirmLiveTheme: true }), {
    filename: "templates/index.json", jobId: null,
  });
  assert.equal(mutations, 1);
});

test("theme update rejects a theme that became active after it was selected", async () => {
  let mutations = 0;
  const client = { async query(document) {
    if (document.includes("ThemeRoleBeforeUpdate")) {
      return { theme: { id: "gid://shopify/OnlineStoreTheme/1", name: "Current", role: "MAIN" } };
    }
    mutations += 1;
  } };
  await assert.rejects(updateThemeFile(client, {
    themeId: "gid://shopify/OnlineStoreTheme/1", filePath: "templates/index.json", fileContent: "{}", expectedRole: "UNPUBLISHED", confirmLiveTheme: true,
  }), /now MAIN/);
  assert.equal(mutations, 0);
});
