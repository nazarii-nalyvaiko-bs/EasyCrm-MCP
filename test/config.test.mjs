import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeStoreDomain } from "../dist/shopify/config.js";

test("Shopify domain normalization keeps the selected store", () => {
  assert.equal(normalizeStoreDomain("My-Store"), "my-store.myshopify.com");
  assert.equal(normalizeStoreDomain("my-store.myshopify.com"), "my-store.myshopify.com");
  assert.throws(() => normalizeStoreDomain("other-store.example.com"));
  assert.throws(() => normalizeStoreDomain("my-store.myshopify.com.evil.example"));
});
