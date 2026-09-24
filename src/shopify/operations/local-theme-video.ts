import { constants, openAsBlob } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { ShopifyClient } from "../client.js";
import { stageLocalUpload } from "./staged-upload.js";

const MAX_VIDEO_BYTES = 1024 * 1024 * 1024;

async function localVideo(filePath: string): Promise<{ filename: string; blob: Blob }> {
  if (!isAbsolute(filePath)) throw new Error("Use an absolute local video path.");
  const filename = basename(filePath);
  const extension = extname(filename).toLowerCase();
  if (extension !== ".mp4") throw new Error("Local theme videos must be MP4 files.");
  if ((await lstat(filePath)).isSymbolicLink()) throw new Error("The local video path must not be a symbolic link.");

  const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile()) throw new Error("The local video path must point to a regular file.");
    if (info.size === 0 || info.size > MAX_VIDEO_BYTES) {
      throw new Error("Local videos must be nonempty and no larger than 1 GB.");
    }
    const signature = Buffer.alloc(12);
    await file.read(signature, 0, signature.length, 0);
    if (signature.toString("ascii", 4, 8) !== "ftyp") {
      throw new Error("The local file does not have an MP4 signature.");
    }
    const blob = await openAsBlob(filePath, { type: "video/mp4" });
    if (blob.size !== info.size) throw new Error("The local video changed while it was being read.");
    return { filename, blob };
  } finally {
    await file.close();
  }
}

export async function stageLocalVideo(
  client: ShopifyClient,
  filePath: string,
  send: typeof fetch = fetch,
): Promise<{ resourceUrl: string; filename: string }> {
  const video = await localVideo(filePath);
  const resourceUrl = await stageLocalUpload(client, {
    filename: video.filename,
    mimeType: "video/mp4",
    blob: video.blob,
    resource: "VIDEO",
  }, send);
  return { resourceUrl, filename: video.filename };
}
