import assert from "node:assert/strict";
import { test } from "node:test";
import { ClientCredentialsTokenProvider } from "../dist/shopify/auth/auth.js";

test("rejects a malformed Shopify credential exchange response", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls += 1;
    assert.equal(url, "https://example.myshopify.com/admin/oauth/access_token");
    assert.equal(options.method, "POST");
    return Response.json({ access_token: "test-token", expires_in: "3600" });
  });

  const provider = new ClientCredentialsTokenProvider("example.myshopify.com", {
    clientId: "client-id",
    clientSecret: "client-secret",
  });
  await assert.rejects(provider.getToken(), {
    name: "Error",
    message: "Shopify returned an invalid credential exchange response",
  });
  assert.equal(calls, 1);
});
