import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AppConfig } from "./app-config.js";
import { HoroshopClient } from "./horoshop/client.js";
import { SERVER_NAME, VERSION } from "./identity.js";
import { createTokenProvider } from "./shopify/auth/auth.js";
import { ShopifyClient } from "./shopify/client.js";
import { registerHoroshopTools } from "./tools/horoshop.js";
import { registerShopifyAnalyticsTools } from "./tools/shopify-analytics.js";
import { registerShopifyCatalogCustomerTools } from "./tools/shopify-catalog-customers.js";
import { registerShopifyDiscountTools } from "./tools/shopify-discounts.js";
import { registerShopifyOrderTools } from "./tools/shopify-orders.js";
import { registerShopTools } from "./tools/shopify.js";

const SERVER_INSTRUCTIONS =
  "Tools are prefixed by platform and operate only on the configured store for that platform. " +
  "Shopify and Horoshop authentication is automatic. If credentials or API permissions fail, " +
  "the user must update the store configuration.";

export function createServer(config: AppConfig): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: VERSION },
    { instructions: SERVER_INSTRUCTIONS },
  );
  if (config.shopify) {
    const tokenProvider = createTokenProvider(config.shopify.storeDomain, config.shopify.auth);
    const client = new ShopifyClient(config.shopify, tokenProvider);
    registerShopTools(server, client);
    registerShopifyCatalogCustomerTools(server, client);
    registerShopifyOrderTools(server, client);
    registerShopifyDiscountTools(server, client);
    registerShopifyAnalyticsTools(server, client);
  }
  if (config.horoshop) {
    registerHoroshopTools(server, new HoroshopClient(config.horoshop));
  }

  return server;
}
