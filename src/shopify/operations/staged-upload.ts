import type { ShopifyClient } from "../client.js";
import type { UserError } from "../errors.js";
import { unwrapMutation } from "./mutation.js";

export interface LocalUpload {
  filename: string;
  mimeType: string;
  blob: Blob;
  resource: "IMAGE" | "SHOP_IMAGE" | "VIDEO";
}

interface StagedUploadTarget {
  url: string;
  resourceUrl: string;
  parameters: { name: string; value: string }[];
}

function httpsUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`Shopify returned an invalid ${label} URL.`);
  }
  if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
    throw new Error(`Shopify returned an invalid ${label} URL.`);
  }
  return url.href;
}

export async function stageLocalUpload(
  client: ShopifyClient,
  upload: LocalUpload,
  send: typeof fetch = fetch,
): Promise<string> {
  const data = await client.query<{
    stagedUploadsCreate: { stagedTargets: StagedUploadTarget[] | null; userErrors: UserError[] };
  }>(
    `mutation StageLocalUpload($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    { input: [{
      filename: upload.filename,
      mimeType: upload.mimeType,
      resource: upload.resource,
      httpMethod: "POST",
      ...(upload.resource === "VIDEO" ? { fileSize: String(upload.blob.size) } : {}),
    }] },
  );
  const targets = unwrapMutation("stagedUploadsCreate", data.stagedUploadsCreate.stagedTargets, data.stagedUploadsCreate.userErrors);
  if (targets.length !== 1) throw new Error("Shopify did not return one staged upload target.");
  const target = targets[0];
  const uploadUrl = httpsUrl(target.url, "upload target");
  const resourceUrl = httpsUrl(target.resourceUrl, "staged resource");
  if (!Array.isArray(target.parameters) || target.parameters.some((parameter) =>
    !parameter || typeof parameter.name !== "string" || typeof parameter.value !== "string" || parameter.name === "file"
  )) {
    throw new Error("Shopify returned invalid staged upload parameters.");
  }

  const form = new FormData();
  for (const { name, value } of target.parameters) form.append(name, value);
  form.append("file", upload.blob, upload.filename);
  const response = await send(uploadUrl, { method: "POST", body: form, redirect: "error" });
  if (!response.ok) throw new Error(`Shopify staged upload failed with HTTP ${response.status}.`);
  return resourceUrl;
}
