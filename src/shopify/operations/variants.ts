import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { unwrapMutation } from "./mutation.js";

export interface ProductVariant {
  id: string;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  inventoryQuantity: number | null;
  inventoryItem: { id: string; tracked: boolean };
}

interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface LocationPage {
  nodes: { id: string; name: string; isActive: boolean }[];
  pageInfo: PageInfo;
}

export async function listInventoryLocations(
  client: ShopifyClient,
  first: number,
  after?: string,
): Promise<LocationPage> {
  const data = await client.query<{ locations: LocationPage }>(
    `query ListInventoryLocations($first: Int!, $after: String) {
      locations(first: $first, after: $after) {
        nodes { id name isActive }
        pageInfo { hasNextPage endCursor }
      }
    }`,
    { first, after },
  );
  return data.locations;
}

interface VariantPage {
  nodes: ProductVariant[];
  pageInfo: PageInfo;
}

export async function listProductVariants(
  client: ShopifyClient,
  productId: string,
  first: number,
  after?: string,
): Promise<VariantPage> {
  const data = await client.query<{ product: { variants: VariantPage } | null }>(
    `query ListProductVariants($productId: ID!, $first: Int!, $after: String) {
      product(id: $productId) {
        variants(first: $first, after: $after) {
          nodes {
            id title sku price compareAtPrice inventoryQuantity
            inventoryItem { id tracked }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { productId, first, after },
  );
  if (!data.product) throw new Error(`Product ${productId} was not found`);
  return data.product.variants;
}

export interface InventoryLevel {
  location: { id: string; name: string };
  quantities: { name: string; quantity: number }[];
}

export interface InventoryLevelPage {
  inventoryItemId: string;
  tracked: boolean;
  levels: { nodes: InventoryLevel[]; pageInfo: PageInfo };
}

export async function listVariantInventory(
  client: ShopifyClient,
  variantId: string,
  first: number,
  after?: string,
): Promise<InventoryLevelPage> {
  const data = await client.query<{
    productVariant: {
      inventoryItem: {
        id: string;
        tracked: boolean;
        inventoryLevels: { nodes: InventoryLevel[]; pageInfo: PageInfo };
      };
    } | null;
  }>(
    `query ListVariantInventory($variantId: ID!, $first: Int!, $after: String) {
      productVariant(id: $variantId) {
        inventoryItem {
          id tracked
          inventoryLevels(first: $first, after: $after) {
            nodes {
              location { id name }
              quantities(names: ["available"]) { name quantity }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }`,
    { variantId, first, after },
  );
  if (!data.productVariant) throw new Error(`Variant ${variantId} was not found`);
  const item = data.productVariant.inventoryItem;
  return { inventoryItemId: item.id, tracked: item.tracked, levels: item.inventoryLevels };
}

export async function updateVariantPrice(
  client: ShopifyClient,
  input: {
    productId: string;
    variantId: string;
    price: string;
    compareAtPrice?: string | null;
  },
): Promise<{ id: string; price: string; compareAtPrice: string | null }> {
  const variant = {
    id: input.variantId,
    price: input.price,
    ...(input.compareAtPrice !== undefined ? { compareAtPrice: input.compareAtPrice } : {}),
  };
  const data = await client.query<{
    productVariantsBulkUpdate: {
      productVariants: { id: string; price: string; compareAtPrice: string | null }[] | null;
      userErrors: UserError[];
    };
  }>(
    `mutation UpdateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id price compareAtPrice }
        userErrors { field message }
      }
    }`,
    { productId: input.productId, variants: [variant] },
  );
  const variants = unwrapMutation(
    "productVariantsBulkUpdate",
    data.productVariantsBulkUpdate.productVariants,
    data.productVariantsBulkUpdate.userErrors,
  );
  const updated = variants.find((candidate) => candidate.id === input.variantId);
  if (!updated) throw new Error("productVariantsBulkUpdate did not return the requested variant");
  return updated;
}

export interface SetAvailableInput {
  inventoryItemId: string;
  locationId: string;
  quantity: number;
  compareQuantity: number;
  idempotencyKey: string;
}

export async function setInventoryAvailable(
  client: ShopifyClient,
  input: SetAvailableInput,
): Promise<{
  idempotencyKey: string;
  changes: { name: string; delta: number; quantityAfterChange: number | null }[];
}> {
  const data = await client.query<{
    inventorySetQuantities: {
      inventoryAdjustmentGroup: {
        changes: { name: string; delta: number; quantityAfterChange: number | null }[];
      } | null;
      userErrors: UserError[];
    };
  }>(
    `mutation SetInventoryAvailable($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
      inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
        inventoryAdjustmentGroup {
          changes { name delta quantityAfterChange }
        }
        userErrors { field message }
      }
    }`,
    {
      input: {
        name: "available",
        reason: "correction",
        quantities: [{
          inventoryItemId: input.inventoryItemId,
          locationId: input.locationId,
          quantity: input.quantity,
          compareQuantity: input.compareQuantity,
        }],
      },
      idempotencyKey: input.idempotencyKey,
    },
  );
  const group = unwrapMutation(
    "inventorySetQuantities",
    data.inventorySetQuantities.inventoryAdjustmentGroup,
    data.inventorySetQuantities.userErrors,
  );
  return { idempotencyKey: input.idempotencyKey, changes: group.changes };
}
