import {
  loadHoroshopConfig,
  toHoroshopEnv,
  toMaskedHoroshopEnv,
  type HoroshopConfig,
} from "./horoshop/config.js";
import {
  loadShopifyConfig,
  toMaskedShopifyEnv,
  toShopifyEnv,
  type ShopifyConfig,
} from "./shopify/config.js";

export interface AppConfig {
  shopify?: ShopifyConfig;
  horoshop?: HoroshopConfig;
}

export function loadAppConfig(): AppConfig {
  const hasShopify = ["SHOPIFY_STORE_DOMAIN", "SHOPIFY_ADMIN_ACCESS_TOKEN", "SHOPIFY_CLIENT_ID", "SHOPIFY_CLIENT_SECRET"]
    .some((name) => process.env[name] !== undefined);
  const hasHoroshop = ["HOROSHOP_STORE_URL", "HOROSHOP_LOGIN", "HOROSHOP_PASSWORD"]
    .some((name) => process.env[name] !== undefined);
  if (!hasShopify && !hasHoroshop) {
    throw new Error("Configure Shopify and/or Horoshop credentials before starting the server");
  }
  return {
    ...(hasShopify && { shopify: loadShopifyConfig() }),
    ...(hasHoroshop && { horoshop: loadHoroshopConfig() }),
  };
}

export function toAppEnv(config: AppConfig): Record<string, string> {
  return {
    ...(config.shopify && toShopifyEnv(config.shopify)),
    ...(config.horoshop && toHoroshopEnv(config.horoshop)),
  };
}

export function toMaskedAppEnv(config: AppConfig): Record<string, string> {
  return {
    ...(config.shopify && toMaskedShopifyEnv(config.shopify)),
    ...(config.horoshop && toMaskedHoroshopEnv(config.horoshop)),
  };
}
