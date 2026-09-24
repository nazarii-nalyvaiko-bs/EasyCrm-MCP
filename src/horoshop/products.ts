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
  const result = await client.request("catalog/export", {
    offset: search.offset,
    limit: search.limit,
    ...(search.article && { expr: { article: search.article } }),
  });
  if (result.status === "EMPTY") return [];
  if (result.status !== "OK") throw new Error(`Horoshop catalog/export returned ${result.status}`);
  const response = result.response;
  if (!response || typeof response !== "object" || !("products" in response) || !Array.isArray(response.products) || response.products.some((product) =>
    !product || typeof product !== "object" || !("article" in product) || typeof product.article !== "string"
  )) {
    throw new Error("Horoshop catalog/export returned an invalid product list");
  }
  return response.products as HoroshopProduct[];
}

export interface ProductUpdate {
  article: string;
  price?: number;
  title?: string;
  description?: string;
  visible?: boolean;
  stock?: { warehouse: string; quantity: number };
}

export interface ProductCreate {
  article: string;
  title: string;
  categoryId: number;
  price?: number;
  description?: string;
  visible?: boolean;
}

export async function createProduct(client: HoroshopClient, product: ProductCreate): Promise<{ article: string; created: true }> {
  const existing = await listProducts(client, { article: product.article, offset: 0, limit: 2 });
  if (existing.some((candidate) => candidate.article === product.article)) {
    throw new Error(`Horoshop product ${product.article} already exists`);
  }
  const result = await client.request("catalog/import", {
    products: [{
      article: product.article,
      title: product.title,
      parent: { id: product.categoryId },
      ...(product.price !== undefined && { price: product.price }),
      ...(product.description !== undefined && { description: product.description }),
      ...(product.visible !== undefined && { display_in_showcase: product.visible }),
    }],
  });
  if (result.status !== "OK") throw new Error(`Horoshop catalog/import returned ${result.status}`);
  return { article: product.article, created: true };
}

export async function updateProduct(client: HoroshopClient, update: ProductUpdate): Promise<{ article: string; updated: true }> {
  const { article, price, title, description, visible, stock } = update;
  if ([price, title, description, visible, stock].every((value) => value === undefined)) {
    throw new Error("Provide at least one product field to update");
  }
  const existing = await listProducts(client, { article, offset: 0, limit: 2 });
  if (!existing.some((product) => product.article === article)) {
    throw new Error(`Horoshop product ${article} was not found; product creation requires category and title`);
  }
  const result = await client.request("catalog/import", {
    products: [{
      article,
      ...(price !== undefined && { price }),
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(visible !== undefined && { display_in_showcase: visible }),
      ...(stock !== undefined && { residues: [stock] }),
    }],
  });
  if (result.status !== "OK") throw new Error(`Horoshop catalog/import returned ${result.status}`);
  return { article, updated: true };
}
