import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { addLocalProductImage, stageLocalImage } from "../dist/shopify/operations/local-product-media.js";

const productId = "gid://shopify/Product/1";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

function api(...responses) {
  const calls = [];
  return {
    calls,
    async query(document, variables) {
      calls.push({ document, variables });
      const response = responses.shift();
      if (!response) throw new Error("Unexpected Shopify query");
      return response;
    },
  };
}

function staged(resourceUrl = "https://shop.myshopify.com/admin/tmp/files/image.png") {
  return {
    stagedUploadsCreate: {
      stagedTargets: [{
        url: "https://uploads.shopify.com/stage",
        resourceUrl,
        parameters: [{ name: "key", value: "tmp/image.png" }, { name: "policy", value: "signed" }],
      }],
      userErrors: [],
    },
  };
}

async function withImage(run) {
  const dir = await mkdtemp(join(tmpdir(), "easycrm-image-"));
  const path = join(dir, "image.png");
  await writeFile(path, png);
  try {
    return await run(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("local product image uses staged multipart upload before attaching media", async () => {
  await withImage(async (path) => {
    const client = api(staged(), { productUpdate: { product: { id: productId }, userErrors: [] } });
    let uploaded = false;
    const send = async (url, options) => {
      assert.equal(url, "https://uploads.shopify.com/stage");
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.equal(options.body.get("key"), "tmp/image.png");
      assert.equal(options.body.get("policy"), "signed");
      const file = options.body.get("file");
      assert.equal(file.name, "image.png");
      assert.equal(file.type, "image/png");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), png);
      uploaded = true;
      return { ok: true, status: 201 };
    };
    const outcome = await addLocalProductImage(client, productId, path, "Front view", send);
    assert.deepEqual(outcome, {
      productId, filename: "image.png", submittedImageCount: 1, processing: "async",
    });
    assert.equal(uploaded, true);
    assert.deepEqual(client.calls[0].variables.input, [{
      filename: "image.png", mimeType: "image/png", resource: "IMAGE", httpMethod: "POST",
    }]);
    assert.deepEqual(client.calls[1].variables.media, [{
      originalSource: "https://shop.myshopify.com/admin/tmp/files/image.png",
      mediaContentType: "IMAGE",
      alt: "Front view",
    }]);
  });
});

test("stageLocalImage supports Shopify Files image resource", async () => {
  await withImage(async (path) => {
    const client = api(staged());
    const outcome = await stageLocalImage(client, path, "SHOP_IMAGE", async () => ({ ok: true, status: 204 }));
    assert.equal(outcome.resourceUrl, "https://shop.myshopify.com/admin/tmp/files/image.png");
    assert.equal(outcome.mimeType, "image/png");
    assert.equal(client.calls[0].variables.input[0].resource, "SHOP_IMAGE");
  });
});

test("invalid, oversized, and relative local paths are rejected before Shopify calls", async () => {
  const client = api();
  await assert.rejects(addLocalProductImage(client, productId, "relative.png"), /absolute/);
  await withImage(async (path) => {
    await writeFile(path, Buffer.from("not an image"));
    await assert.rejects(addLocalProductImage(client, productId, path), /does not match/);
    await truncate(path, 20 * 1024 * 1024 + 1);
    await assert.rejects(addLocalProductImage(client, productId, path), /no larger than 20 MB/);
  });
  assert.equal(client.calls.length, 0);
});

test("symbolic links are rejected before staging", async () => {
  await withImage(async (path) => {
    const link = join(dirname(path), "link.png");
    await symlink(path, link);
    const client = api();
    await assert.rejects(addLocalProductImage(client, productId, link));
    assert.equal(client.calls.length, 0);
  });
});

test("staged target errors never upload or mutate the product", async () => {
  await withImage(async (path) => {
    const client = api({ stagedUploadsCreate: { stagedTargets: null, userErrors: [{ field: ["input"], message: "Rejected" }] } });
    await assert.rejects(addLocalProductImage(client, productId, path, undefined, async () => {
      throw new Error("Upload should not run");
    }), /Rejected/);
    assert.equal(client.calls.length, 1);
  });
});

test("upload failure does not attach media", async () => {
  await withImage(async (path) => {
    const client = api(staged());
    await assert.rejects(addLocalProductImage(client, productId, path, undefined, async () => ({ ok: false, status: 403 })), /HTTP 403/);
    assert.equal(client.calls.length, 1);
  });
});

test("an unsafe staged upload URL is rejected before sending file bytes", async () => {
  await withImage(async (path) => {
    const response = staged();
    response.stagedUploadsCreate.stagedTargets[0].url = "http://uploads.example.com/stage";
    const client = api(response);
    await assert.rejects(addLocalProductImage(client, productId, path, undefined, async () => {
      throw new Error("Upload should not run");
    }), /invalid upload target URL/);
    assert.equal(client.calls.length, 1);
  });
});

test("attachment failure identifies the completed staging step", async () => {
  await withImage(async (path) => {
    const client = api(staged(), { productUpdate: { product: null, userErrors: [{ field: ["media"], message: "Rejected" }] } });
    await assert.rejects(addLocalProductImage(client, productId, path, undefined, async () => ({ ok: true, status: 201 })),
      /uploaded to Shopify staging but was not attached.*Rejected/);
  });
});
