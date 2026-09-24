import type { HoroshopClient } from "./client.js";

export interface ProductSearch {
  article?: string;
  offset: number;
  limit: number;
}

export interface HoroshopProduct extends Record<string, unknown> {
  article: string;
}

export async function listProducts(
  client: HoroshopClient,
  search: ProductSearch,
): Promise<HoroshopProduct[]> {
  const response = await client.request<{ products: unknown[] }>("catalog/export", {
    offset: search.offset,
    limit: search.limit,
    ...(search.article && { expr: { article: search.article } }),
  });
  if (response === null) return [];
  if (!Array.isArray(response.products) || response.products.some((product) =>
    !product || typeof product !== "object" || !("article" in product) || typeof product.article !== "string"
  )) {
    throw new Error("Horoshop catalog/export returned an invalid product list");
  }
  return response.products as HoroshopProduct[];
}
