import { z } from "zod";
import type { HoroshopClient } from "./client.js";

export interface ProductSearch {
  article?: string;
  offset: number;
  limit: number;
}

const productSchema = z.object({ article: z.string().min(1) }).passthrough();
const productListSchema = z.object({ products: z.array(productSchema) });

export type HoroshopProduct = z.infer<typeof productSchema>;

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
  const parsed = productListSchema.safeParse(result.response);
  if (!parsed.success) throw new Error("Horoshop catalog/export returned an invalid product list");
  return parsed.data.products;
}

export interface ProductUpdate {
  article: string;
  price?: number;
  title?: string;
  description?: string;
  visible?: boolean;
  stock?: { warehouse: string; quantity: number };
  variantImages?: ProductImageUpdate;
  commonGallery?: ProductImageUpdate;
}

export interface ProductImageUpdate {
  links: string[];
  mode: "append" | "replace";
}

export interface ProductCreate {
  article: string;
  title: string;
  categoryId: number;
  price?: number;
  description?: string;
  visible?: boolean;
  variantImageUrls?: string[];
  commonGalleryImageUrls?: string[];
}

function imageImport(images: ProductImageUpdate): { links: string[]; override: boolean } {
  if (images.links.length === 0) throw new Error("Provide at least one image URL");
  return { links: images.links, override: images.mode === "replace" };
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
      ...(product.variantImageUrls !== undefined && { images: imageImport({ links: product.variantImageUrls, mode: "append" }) }),
      ...(product.commonGalleryImageUrls !== undefined && { gallery_common: imageImport({ links: product.commonGalleryImageUrls, mode: "append" }) }),
    }],
  });
  if (result.status !== "OK") throw new Error(`Horoshop catalog/import returned ${result.status}`);
  return { article: product.article, created: true };
}

export async function updateProduct(client: HoroshopClient, update: ProductUpdate): Promise<{ article: string; updated: true }> {
  const { article, price, title, description, visible, stock, variantImages, commonGallery } = update;
  if ([price, title, description, visible, stock, variantImages, commonGallery].every((value) => value === undefined)) {
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
      ...(variantImages !== undefined && { images: imageImport(variantImages) }),
      ...(commonGallery !== undefined && { gallery_common: imageImport(commonGallery) }),
    }],
  });
  if (result.status !== "OK") throw new Error(`Horoshop catalog/import returned ${result.status}`);
  return { article, updated: true };
}
