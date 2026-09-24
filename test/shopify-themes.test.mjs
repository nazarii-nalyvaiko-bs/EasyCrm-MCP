import assert from "node:assert/strict";
import { test } from "node:test";
import { updateThemeFile } from "../dist/shopify/operations/themes.js";

test("theme update requires a returned file or background job", async () => {
  const input = { themeId: "gid://shopify/OnlineStoreTheme/1", filePath: "templates/index.json", fileContent: "{}", expectedRole: "UNPUBLISHED" };
  let calls = 0;
  const client = { async query(document, variables) {
    calls += 1;
    if (calls === 1) {
      assert.match(document, /query ThemeRoleBeforeUpdate/);
      assert.deepEqual(variables, { id: input.themeId });
      return { theme: { id: input.themeId, name: "Draft", role: "UNPUBLISHED" } };
    }
    if (calls === 2) {
      assert.match(document, /mutation UpdateThemeFile/);
      assert.deepEqual(variables, { themeId: input.themeId, filePath: input.filePath, fileContent: input.fileContent });
      return { themeFilesUpsert: { upsertedThemeFiles: [], job: null, userErrors: [] } };
    }
    throw new Error("Unexpected Shopify query");
  } };
  await assert.rejects(updateThemeFile(client, input), /did not confirm/);
  assert.equal(calls, 2);
});

test("theme update rejects confirmation for a different file", async () => {
  const input = { themeId: "gid://shopify/OnlineStoreTheme/1", filePath: "templates/index.json", fileContent: "{}", expectedRole: "UNPUBLISHED" };
  let calls = 0;
  const client = { async query(document, variables) {
    calls += 1;
    if (calls === 1) {
      assert.match(document, /query ThemeRoleBeforeUpdate/);
      assert.deepEqual(variables, { id: input.themeId });
      return { theme: { id: input.themeId, name: "Draft", role: "UNPUBLISHED" } };
    }
    if (calls === 2) {
      assert.match(document, /mutation UpdateThemeFile/);
      assert.deepEqual(variables, { themeId: input.themeId, filePath: input.filePath, fileContent: input.fileContent });
      return { themeFilesUpsert: { upsertedThemeFiles: [{ filename: "templates/other.json" }], job: null, userErrors: [] } };
    }
    throw new Error("Unexpected Shopify query");
  } };
  await assert.rejects(updateThemeFile(client, input), /confirmed templates\/other.json instead of templates\/index.json/);
  assert.equal(calls, 2);
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
