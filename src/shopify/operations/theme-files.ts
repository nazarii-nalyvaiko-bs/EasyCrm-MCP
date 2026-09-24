import type { ShopifyClient } from "../client.js";
import { ShopifyUserError, type UserError } from "../errors.js";
import { stageLocalImage } from "./local-product-media.js";
import { stageLocalVideo } from "./local-theme-video.js";
import { referenceForMedia } from "./theme-media.js";

type FileStatus = "UPLOADED" | "PROCESSING" | "READY" | "FAILED";
type MediaKind = "image_picker" | "video";

interface StoredFile {
  id: string;
  fileStatus: FileStatus;
  mediaStatus: FileStatus;
  fileErrors: { message: string }[];
  mediaErrors: { message: string }[];
  image?: { url: string } | null;
  filename?: string;
}

export interface ThemeMediaFile {
  id: string;
  kind: MediaKind;
  status: FileStatus;
  reference: string | null;
  errors: string[];
}

const FILE_FIELDS = `
  id fileStatus fileErrors { message }
  ... on MediaImage { mediaStatus: status mediaErrors { message } image { url } }
  ... on Video { mediaStatus: status mediaErrors { message } filename }
`;

function filenameFromImageUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || (parsed.hostname !== "cdn.shopify.com" && !parsed.hostname.endsWith(".shopifycdn.com"))) {
    throw new Error("Shopify returned an unexpected image CDN URL. Inspect the file before using it in a theme.");
  }
  const filename = decodeURIComponent(parsed.pathname.split("/").at(-1) ?? "");
  if (!filename || filename.includes("/") || filename.includes("\\")) {
    throw new Error("Shopify returned an invalid image filename.");
  }
  return filename;
}

function toMediaFile(file: StoredFile, kind: MediaKind): ThemeMediaFile {
  const filename = kind === "video" ? file.filename : file.image?.url ? filenameFromImageUrl(file.image.url) : null;
  const status = file.fileStatus === "FAILED" || file.mediaStatus === "FAILED"
    ? "FAILED" : file.fileStatus === "READY" && file.mediaStatus === "READY" ? "READY" : "PROCESSING";
  return {
    id: file.id,
    kind,
    status,
    reference: status === "READY" && filename ? referenceForMedia(kind, filename) : null,
    errors: [...file.fileErrors, ...file.mediaErrors].map(({ message }) => message),
  };
}

export async function uploadLocalThemeMedia(
  client: ShopifyClient,
  filePath: string,
  kind: MediaKind,
  send: typeof fetch = fetch,
): Promise<ThemeMediaFile> {
  const staged = kind === "image_picker"
    ? await stageLocalImage(client, filePath, "SHOP_IMAGE", send)
    : await stageLocalVideo(client, filePath, send);
  const data = await client.query<{
    fileCreate: { files: (StoredFile | null)[] | null; userErrors: UserError[] };
  }>(
    `mutation CreateThemeMediaFile($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { ${FILE_FIELDS} }
        userErrors { field message }
      }
    }`,
    {
      files: [{
        originalSource: staged.resourceUrl,
        contentType: kind === "image_picker" ? "IMAGE" : "VIDEO",
        filename: staged.filename,
        duplicateResolutionMode: "RAISE_ERROR",
      }],
    },
  );
  if (data.fileCreate.userErrors.length) throw new ShopifyUserError("fileCreate", data.fileCreate.userErrors);
  const file = data.fileCreate.files?.[0];
  if (!file) throw new Error("Shopify did not return the created File. Check Files before retrying.");
  return toMediaFile(file, kind);
}

export async function getThemeMediaFile(
  client: ShopifyClient,
  fileId: string,
  kind: MediaKind,
): Promise<ThemeMediaFile> {
  const data = await client.query<{ node: (StoredFile & { __typename: string }) | null }>(
    `query ThemeMediaFile($id: ID!) {
      node(id: $id) {
        __typename
        ... on MediaImage { id fileStatus fileErrors { message } mediaStatus: status mediaErrors { message } image { url } }
        ... on Video { id fileStatus fileErrors { message } mediaStatus: status mediaErrors { message } filename }
      }
    }`,
    { id: fileId },
  );
  const expectedType = kind === "image_picker" ? "MediaImage" : "Video";
  if (!data.node || data.node.__typename !== expectedType) throw new Error(`File ${fileId} is not a ${expectedType}`);
  return toMediaFile(data.node, kind);
}
