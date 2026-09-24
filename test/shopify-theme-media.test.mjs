import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { getThemeMediaFile, uploadLocalThemeMedia } from "../dist/shopify/operations/theme-files.js";
import { stageLocalVideo } from "../dist/shopify/operations/local-theme-video.js";
import { listThemeMediaSlots, updateThemeMediaSetting } from "../dist/shopify/operations/theme-media.js";

const themeId = "gid://shopify/OnlineStoreTheme/1";
const templatePath = "templates/index.json";
const sectionSchema = `{% schema %}{"name":"Banner","settings":[{"type":"image_picker","id":"hero","label":"Hero image"}],"blocks":[{"type":"slide","settings":[{"type":"video","id":"clip","label":"Slide video"}]}]}{% endschema %}`;
const template = {
  sections: {
    banner_1: {
      type: "banner",
      settings: { hero: "shopify://shop_images/old.jpg", heading: "Welcome" },
      blocks: { slide_1: { type: "slide", settings: { heading: "First" } } },
      block_order: ["slide_1"],
    },
  },
  order: ["banner_1"],
};

function themeClient(content = JSON.stringify(template), role = "UNPUBLISHED") {
  const calls = [];
  return {
    calls,
    async query(document, variables) {
      calls.push({ document, variables });
      if (document.includes("query ReadThemeFile")) {
        const text = variables.filePath === templatePath ? content : sectionSchema;
        return { theme: { files: { nodes: [{ filename: variables.filePath, body: { content: text } }] } } };
      }
      if (document.includes("query ThemeRoleBeforeUpdate")) return { theme: { id: themeId, name: "Draft", role } };
      if (document.includes("mutation UpdateThemeFile")) {
        return { themeFilesUpsert: { upsertedThemeFiles: [{ filename: templatePath }], job: null, userErrors: [] } };
      }
      throw new Error("Unexpected Shopify query");
    },
  };
}

test("theme media inspection uses section and block schema, including empty picker slots", async () => {
  const client = themeClient();
  assert.deepEqual(await listThemeMediaSlots(client, themeId, templatePath), [
    { sectionId: "banner_1", blockId: null, settingId: "hero", kind: "image_picker", label: "Hero image", currentValue: "shopify://shop_images/old.jpg" },
    { sectionId: "banner_1", blockId: "slide_1", settingId: "clip", kind: "video", label: "Slide video", currentValue: null },
  ]);
  assert.equal(client.calls.filter(({ variables }) => variables.filePath === "sections/banner.liquid").length, 1);
});

test("theme media inspection includes global image pickers", async () => {
  const client = {
    async query(_document, variables) {
      const content = variables.filePath === "config/settings_schema.json"
        ? JSON.stringify([{ name: "Logo", settings: [{ type: "image_picker", id: "logo", label: "Store logo" }] }])
        : JSON.stringify({ current: { settings: {}, sections: {} } });
      return { theme: { files: { nodes: [{ filename: variables.filePath, body: { content } }] } } };
    },
  };
  assert.deepEqual(await listThemeMediaSlots(client, themeId, "config/settings_data.json"), [
    { sectionId: null, blockId: null, settingId: "logo", kind: "image_picker", label: "Store logo", currentValue: null },
  ]);
});

test("theme media update changes only the selected block setting", async () => {
  const header = "/* Shopify generated theme content */\n";
  const client = themeClient(header + JSON.stringify(template));
  const outcome = await updateThemeMediaSetting(client, {
    themeId,
    filePath: templatePath,
    sectionId: "banner_1",
    blockId: "slide_1",
    settingId: "clip",
    reference: "shopify://files/videos/new.mp4",
    expectedCurrentValue: null,
    expectedRole: "UNPUBLISHED",
  });
  assert.equal(outcome.reference, "shopify://files/videos/new.mp4");
  const mutation = client.calls.find(({ document }) => document.includes("mutation UpdateThemeFile"));
  assert.ok(mutation.variables.fileContent.startsWith(header));
  const saved = JSON.parse(mutation.variables.fileContent.slice(header.length));
  assert.equal(saved.sections.banner_1.blocks.slide_1.settings.clip, "shopify://files/videos/new.mp4");
  assert.equal(saved.sections.banner_1.settings.hero, "shopify://shop_images/old.jpg");
  assert.equal(saved.sections.banner_1.settings.heading, "Welcome");
  assert.deepEqual(saved.order, ["banner_1"]);
});

test("theme media update rejects stale values and mismatched media types before mutation", async () => {
  const client = themeClient();
  const input = {
    themeId, filePath: templatePath, sectionId: "banner_1", settingId: "hero",
    reference: "shopify://shop_images/new.jpg", expectedCurrentValue: null, expectedRole: "UNPUBLISHED",
  };
  await assert.rejects(updateThemeMediaSetting(client, input), /Media setting changed/);
  await assert.rejects(updateThemeMediaSetting(client, {
    ...input, reference: "shopify://files/videos/new.mp4", expectedCurrentValue: "shopify://shop_images/old.jpg",
  }), /requires a shopify:\/\/shop_images/);
  assert.equal(client.calls.some(({ document }) => document.includes("mutation UpdateThemeFile")), false);
});

test("theme media update retains live theme approval and role guard", async () => {
  const input = {
    themeId, filePath: templatePath, sectionId: "banner_1", settingId: "hero",
    reference: "shopify://shop_images/new.jpg", expectedCurrentValue: "shopify://shop_images/old.jpg",
    expectedRole: "MAIN",
  };
  const client = themeClient(JSON.stringify(template), "MAIN");
  await assert.rejects(updateThemeMediaSetting(client, input), /Ask the user/);
  assert.equal(client.calls.some(({ document }) => document.includes("mutation UpdateThemeFile")), false);
  const changed = themeClient(JSON.stringify(template), "MAIN");
  await assert.rejects(updateThemeMediaSetting(changed, { ...input, expectedRole: "UNPUBLISHED", confirmLiveTheme: true }), /now MAIN/);
  assert.equal(changed.calls.some(({ document }) => document.includes("mutation UpdateThemeFile")), false);
});

test("file status produces actual Shopify Files references only when READY", async () => {
  const image = {
    async query(document, variables) {
      assert.match(document, /query ThemeMediaFile/);
      assert.equal(variables.id, "gid://shopify/MediaImage/2");
      return { node: { __typename: "MediaImage", id: variables.id, fileStatus: "READY", mediaStatus: "READY", fileErrors: [], mediaErrors: [], image: { url: "https://cdn.shopify.com/s/files/1/old/banner.jpg?v=123" } } };
    },
  };
  assert.deepEqual(await getThemeMediaFile(image, "gid://shopify/MediaImage/2", "image_picker"), {
    id: "gid://shopify/MediaImage/2", kind: "image_picker", status: "READY", reference: "shopify://shop_images/banner.jpg", errors: [],
  });
  const processing = {
    async query() {
      return { node: { __typename: "Video", id: "gid://shopify/Video/3", fileStatus: "READY", mediaStatus: "PROCESSING", fileErrors: [], mediaErrors: [], filename: "banner.mp4" } };
    },
  };
  assert.equal((await getThemeMediaFile(processing, "gid://shopify/Video/3", "video")).reference, null);
});

test("local theme image is staged as a shop image and created in Shopify Files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "easycrm-theme-image-"));
  const path = join(dir, "banner.png");
  await writeFile(path, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]));
  const calls = [];
  const client = {
    async query(document, variables) {
      calls.push({ document, variables });
      if (document.includes("stagedUploadsCreate")) return { stagedUploadsCreate: {
        stagedTargets: [{ url: "https://uploads.shopify.com/stage", resourceUrl: "https://shop.myshopify.com/admin/tmp/files/banner.png", parameters: [{ name: "key", value: "signed" }] }],
        userErrors: [],
      } };
      return { fileCreate: { files: [{ id: "gid://shopify/MediaImage/3", fileStatus: "PROCESSING", mediaStatus: "PROCESSING", fileErrors: [], mediaErrors: [], image: null }], userErrors: [] } };
    },
  };
  try {
    const file = await uploadLocalThemeMedia(client, path, "image_picker", async (_url, options) => {
      assert.equal(options.body.get("file").name, "banner.png");
      return { ok: true, status: 201 };
    });
    assert.deepEqual(file, { id: "gid://shopify/MediaImage/3", kind: "image_picker", status: "PROCESSING", reference: null, errors: [] });
    assert.equal(calls[0].variables.input[0].resource, "SHOP_IMAGE");
    assert.deepEqual(calls[1].variables.files, [{
      originalSource: "https://shop.myshopify.com/admin/tmp/files/banner.png",
      contentType: "IMAGE", filename: "banner.png", duplicateResolutionMode: "RAISE_ERROR",
    }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("local MP4 video stages with file size and streams bytes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "easycrm-theme-video-"));
  const path = join(dir, "banner.mp4");
  const bytes = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
  await writeFile(path, bytes);
  const calls = [];
  const client = {
    async query(_document, variables) {
      calls.push(variables);
      return { stagedUploadsCreate: {
        stagedTargets: [{ url: "https://uploads.shopify.com/video", resourceUrl: "https://shop.myshopify.com/admin/tmp/files/banner.mp4", parameters: [] }],
        userErrors: [],
      } };
    },
  };
  try {
    const staged = await stageLocalVideo(client, path, async (_url, options) => {
      assert.equal(options.method, "POST");
      assert.equal(options.body.get("file").type, "video/mp4");
      assert.deepEqual(Buffer.from(await options.body.get("file").arrayBuffer()), bytes);
      return { ok: true, status: 201 };
    });
    assert.equal(staged.filename, "banner.mp4");
    assert.deepEqual(calls[0].input, [{ filename: "banner.mp4", mimeType: "video/mp4", resource: "VIDEO", fileSize: String(bytes.length), httpMethod: "POST" }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
