import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { ShopifyClient } from "../client.js";
import { addProductImages } from "./product-media.js";
import { stageLocalUpload } from "./staged-upload.js";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

const IMAGE_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

interface LocalImage {
  filename: string;
  mimeType: string;
  bytes: Buffer;
}

function matchesImageSignature(bytes: Buffer, mimeType: string): boolean {
  switch (mimeType) {
    case "image/png":
      return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/webp":
      return bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    case "image/gif":
      return bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a";
    default:
      return false;
  }
}

async function readLocalImage(filePath: string): Promise<LocalImage> {
  if (!isAbsolute(filePath)) throw new Error("Use an absolute local image path.");

  const filename = basename(filePath);
  const mimeType = IMAGE_TYPES[extname(filename).toLowerCase()];
  if (!mimeType) throw new Error("Supported local image types are PNG, JPEG, WebP, and GIF.");

  if ((await lstat(filePath)).isSymbolicLink()) {
    throw new Error("The local image path must not be a symbolic link.");
  }
  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("The local image path must point to a regular file.");
    if (info.size === 0 || info.size > MAX_IMAGE_BYTES) {
      throw new Error("Local images must be nonempty and no larger than 20 MB.");
    }

    const bytes = await file.readFile();
    if (bytes.length > MAX_IMAGE_BYTES || !matchesImageSignature(bytes, mimeType)) {
      throw new Error("The local file does not match its image extension or exceeds 20 MB.");
    }
    return { filename, mimeType, bytes };
  } finally {
    await file.close();
  }
}

export async function addLocalProductImage(
  client: ShopifyClient,
  productId: string,
  filePath: string,
  alt?: string,
  send: typeof fetch = fetch,
): Promise<{ productId: string; filename: string; submittedImageCount: 1; processing: "async" }> {
  const staged = await stageLocalImage(client, filePath, "IMAGE", send);
  try {
    await addProductImages(client, productId, [{ url: staged.resourceUrl, ...(alt !== undefined ? { alt } : {}) }]);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Image uploaded to Shopify staging but was not attached to the product: ${reason}`);
  }
  return { productId, filename: staged.filename, submittedImageCount: 1, processing: "async" };
}

export async function stageLocalImage(
  client: ShopifyClient,
  filePath: string,
  resource: "IMAGE" | "SHOP_IMAGE",
  send: typeof fetch = fetch,
): Promise<{ resourceUrl: string; filename: string; mimeType: string }> {
  const image = await readLocalImage(filePath);
  const resourceUrl = await stageLocalUpload(client, {
    filename: image.filename,
    mimeType: image.mimeType,
    blob: new Blob([new Uint8Array(image.bytes)], { type: image.mimeType }),
    resource,
  }, send);
  return { resourceUrl, filename: image.filename, mimeType: image.mimeType };
}
