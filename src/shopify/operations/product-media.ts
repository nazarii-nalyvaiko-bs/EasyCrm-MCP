import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { unwrapMutation } from "./mutation.js";
import { updateVariantPrice } from "./variants.js";

export type MediaStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED";

export interface ProductMedia {
  id: string;
  alt: string | null;
  status: MediaStatus;
  mediaContentType: string;
  mediaErrors: { code: string; message: string }[];
  image?: { url: string } | null;
}

export interface ProductMediaPage {
  nodes: ProductMedia[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

export interface ImageSource {
  url: string;
  alt?: string;
}

export interface CreateDraftProductInput {
  title: string;
  descriptionHtml?: string;
  handle?: string;
  vendor?: string;
  productType?: string;
  tags?: string[];
  images: ImageSource[];
  price?: string;
  compareAtPrice?: string | null;
}

interface CreatedProduct {
  id: string;
  title: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED" | "UNLISTED";
  media: ProductMediaPage;
  variants: { nodes: { id: string; price: string }[] };
}

const MEDIA_FIELDS = `
  id alt status mediaContentType
  mediaErrors { code message }
  ... on MediaImage { image { url } }
`;

function asMedia(images: ImageSource[]) {
  return images.map(({ url, alt }) => ({
    originalSource: url,
    mediaContentType: "IMAGE" as const,
    ...(alt !== undefined ? { alt } : {}),
  }));
}

export async function listProductMedia(
  client: ShopifyClient,
  productId: string,
  first: number,
  after?: string,
): Promise<ProductMediaPage> {
  const data = await client.query<{ product: { media: ProductMediaPage } | null }>(
    `query ListProductMedia($productId: ID!, $first: Int!, $after: String) {
      product(id: $productId) {
        media(first: $first, after: $after) {
          nodes { ${MEDIA_FIELDS} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }`,
    { productId, first, after },
  );
  if (!data.product) throw new Error(`Product ${productId} was not found`);
  return data.product.media;
}

export async function addProductImages(
  client: ShopifyClient,
  productId: string,
  images: ImageSource[],
): Promise<{ productId: string; submittedImageCount: number; processing: "async" }> {
  const data = await client.query<{
    productUpdate: { product: { id: string } | null; userErrors: UserError[] };
  }>(
    `mutation AddProductImages($product: ProductUpdateInput!, $media: [CreateMediaInput!]) {
      productUpdate(product: $product, media: $media) {
        product { id }
        userErrors { field message }
      }
    }`,
    { product: { id: productId }, media: asMedia(images) },
  );
  const product = unwrapMutation("productUpdate", data.productUpdate.product, data.productUpdate.userErrors);
  if (product.id !== productId) throw new Error(`productUpdate returned a different product ID: ${product.id}`);
  return { productId, submittedImageCount: images.length, processing: "async" };
}

export async function createDraftProductWithImages(
  client: ShopifyClient,
  input: CreateDraftProductInput,
): Promise<{
  product: CreatedProduct;
  requestedImageCount: number;
  processing: "async";
  priceUpdate: { status: "not_requested" } | { status: "applied"; price: string } | { status: "failed"; message: string };
}> {
  if (input.compareAtPrice !== undefined && input.price === undefined) {
    throw new Error("Provide price when compareAtPrice is set.");
  }
  const { images, price, compareAtPrice, ...details } = input;
  const data = await client.query<{
    productCreate: { product: CreatedProduct | null; userErrors: UserError[] };
  }>(
    `mutation CreateDraftProductWithImages($product: ProductCreateInput!, $media: [CreateMediaInput!]) {
      productCreate(product: $product, media: $media) {
        product {
          id title status
          media(first: 20) {
            nodes { ${MEDIA_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
          variants(first: 1) { nodes { id price } }
        }
        userErrors { field message }
      }
    }`,
    { product: { ...details, status: "DRAFT" }, media: asMedia(images) },
  );
  if (data.productCreate.product && data.productCreate.userErrors.length > 0) {
    const messages = data.productCreate.userErrors.map(({ message }) => message).join("; ");
    throw new Error(`Shopify returned product ${data.productCreate.product.id} with errors: ${messages}. Check the product before retrying.`);
  }
  const product = unwrapMutation("productCreate", data.productCreate.product, data.productCreate.userErrors);
  if (product.status !== "DRAFT") {
    throw new Error(`productCreate returned status ${product.status} instead of DRAFT for ${product.id}`);
  }

  const result = { product, requestedImageCount: images.length, processing: "async" as const };
  if (price === undefined) return { ...result, priceUpdate: { status: "not_requested" } };

  const variantId = product.variants.nodes[0]?.id;
  if (!variantId) {
    return { ...result, priceUpdate: { status: "failed", message: "Product was created, but Shopify returned no initial variant." } };
  }
  try {
    const variant = await updateVariantPrice(client, { productId: product.id, variantId, price, compareAtPrice });
    return { ...result, priceUpdate: { status: "applied", price: variant.price } };
  } catch (error) {
    return {
      ...result,
      priceUpdate: {
        status: "failed",
        message: `Product was created, but its initial price could not be set: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
