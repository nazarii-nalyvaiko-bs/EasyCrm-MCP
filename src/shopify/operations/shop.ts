import type { ShopifyClient } from "../client.js";

export interface Shop {
  name: string;
  myshopifyDomain: string;
  currencyCode: string;
  primaryDomain: { url: string };
  plan: { displayName: string };
}

const SHOP_INFO_QUERY = `
  query ShopInfo {
    shop {
      name
      myshopifyDomain
      currencyCode
      primaryDomain { url }
      plan { displayName }
    }
  }`;

export async function fetchShopInfo(client: ShopifyClient): Promise<Shop> {
  const data = await client.query<{ shop: Shop }>(SHOP_INFO_QUERY);
  return data.shop;
}
