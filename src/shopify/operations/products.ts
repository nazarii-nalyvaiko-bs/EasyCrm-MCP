import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { confirmDeletedId, unwrapMutation } from "./mutation.js";

export interface Product {
  id: string;
  title: string;
  handle: string;
  descriptionHtml: string;
  status: "ACTIVE" | "ARCHIVED" | "DRAFT" | "UNLISTED";
  vendor: string;
  productType: string;
  tags: string[];
}

export interface ProductInput {
  title?: string;
  descriptionHtml?: string;
  handle?: string;
  status?: Product["status"];
  vendor?: string;
  productType?: string;
  tags?: string[];
}

export interface ProductPage {
  nodes: Product[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

interface ProductMutationPayload {
  product: Product | null;
  userErrors: UserError[];
}

const PRODUCT_FIELDS = "id title handle descriptionHtml status vendor productType tags";

export async function listProducts(
  client: ShopifyClient,
  input: { first: number; after?: string; query?: string },
): Promise<ProductPage> {
  const data = await client.query<{ products: ProductPage }>(
    `query ListProducts($first: Int!, $after: String, $query: String) {
      products(first: $first, after: $after, query: $query) {
        nodes { ${PRODUCT_FIELDS} }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    input,
  );
  return data.products;
}

export async function getProduct(client: ShopifyClient, id: string): Promise<Product | null> {
  const data = await client.query<{ product: Product | null }>(
    `query GetProduct($id: ID!) { product(id: $id) { ${PRODUCT_FIELDS} } }`,
    { id },
  );
  return data.product;
}

export async function createProduct(
  client: ShopifyClient,
  product: ProductInput & { title: string },
): Promise<Product> {
  const data = await client.query<{ productCreate: ProductMutationPayload }>(
    `mutation CreateProduct($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product { ${PRODUCT_FIELDS} }
        userErrors { field message }
      }
    }`,
    { product },
  );
  return unwrapMutation("productCreate", data.productCreate.product, data.productCreate.userErrors);
}

export async function updateProduct(
  client: ShopifyClient,
  id: string,
  changes: ProductInput,
): Promise<Product> {
  const data = await client.query<{ productUpdate: ProductMutationPayload }>(
    `mutation UpdateProduct($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product { ${PRODUCT_FIELDS} }
        userErrors { field message }
      }
    }`,
    { product: { id, ...changes } },
  );
  return unwrapMutation("productUpdate", data.productUpdate.product, data.productUpdate.userErrors);
}

export async function deleteProduct(
  client: ShopifyClient,
  id: string,
): Promise<{ deletedProductId: string }> {
  const data = await client.query<{
    productDelete: { deletedProductId: string | null; userErrors: UserError[] };
  }>(
    `mutation DeleteProduct($id: ID!) {
      productDelete(input: { id: $id }, synchronous: true) {
        deletedProductId
        userErrors { field message }
      }
    }`,
    { id },
  );
  return {
    deletedProductId: confirmDeletedId(
      "productDelete",
      id,
      data.productDelete.deletedProductId,
      data.productDelete.userErrors,
    ),
  };
}
