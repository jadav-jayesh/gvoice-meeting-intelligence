import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  BlobSASPermissions,
  BlobServiceClient,
  BlockBlobClient,
  StorageSharedKeyCredential,
  generateBlobSASQueryParameters
} from "@azure/storage-blob";
import { env } from "../config/env";

export interface UploadedArtifact {
  blobName: string;
  url: string;
}

export class AzureBlobStorage {
  private readonly serviceClient: BlobServiceClient;

  constructor() {
    if (!env.AZURE_STORAGE_CONNECTION_STRING) {
      throw new Error("Azure Blob Storage is not configured. Set AZURE_STORAGE_CONNECTION_STRING.");
    }

    this.serviceClient = BlobServiceClient.fromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING);
  }

  async uploadFile(filePath: string, blobName: string, contentType: string): Promise<UploadedArtifact> {
    const container = this.serviceClient.getContainerClient(env.AZURE_STORAGE_CONTAINER);
    await container.createIfNotExists();

    const blockBlob = container.getBlockBlobClient(blobName);
    // Large recordings (~0.9 GB/hr) upload far faster when staged as parallel
    // blocks instead of the SDK's conservative defaults. 8 MB blocks at
    // concurrency 12 saturate the link to Azure (a single TLS connection is
    // latency/window-limited); peak buffered memory ≈ blockSize × concurrency
    // (~96 MB). maxSingleShotSize forces files over 8 MB onto the block path.
    await blockBlob.uploadFile(filePath, {
      blobHTTPHeaders: { blobContentType: contentType },
      blockSize: 8 * 1024 * 1024,
      concurrency: 12,
      maxSingleShotSize: 8 * 1024 * 1024
    });

    return {
      blobName,
      url: this.blobUrl(blockBlob)
    };
  }

  async uploadJson(data: unknown, blobName: string): Promise<UploadedArtifact> {
    const container = this.serviceClient.getContainerClient(env.AZURE_STORAGE_CONTAINER);
    await container.createIfNotExists();

    const blockBlob = container.getBlockBlobClient(blobName);
    const body = JSON.stringify(data, null, 2);
    await blockBlob.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: "application/json" }
    });

    return {
      blobName,
      url: this.blobUrl(blockBlob)
    };
  }

  async uploadTextFile(filePath: string, blobName: string, contentType = "text/plain"): Promise<UploadedArtifact> {
    const body = await readFile(filePath, "utf8");
    const container = this.serviceClient.getContainerClient(env.AZURE_STORAGE_CONTAINER);
    await container.createIfNotExists();
    const blockBlob = container.getBlockBlobClient(blobName);
    await blockBlob.upload(body, Buffer.byteLength(body), {
      blobHTTPHeaders: { blobContentType: contentType }
    });
    return { blobName, url: this.blobUrl(blockBlob) };
  }

  // Download a stored blob to a local file. The processing pipeline consumes
  // local audio paths (ffmpeg/transcription), so an uploaded in-person recording
  // must be pulled back to disk before it can be processed.
  async downloadToFile(blobName: string, destPath: string): Promise<void> {
    const container = this.serviceClient.getContainerClient(env.AZURE_STORAGE_CONTAINER);
    const blockBlob = container.getBlockBlobClient(blobName);
    await blockBlob.downloadToFile(destPath);
  }

  recordingBlobName(sessionId: string): string {
    return path.posix.join(this.basePath(), "meetings", sessionId, "recordings", "recording.mp4");
  }

  // Prefix under which ALL artifacts for a session live (recording, thumbnail,
  // transcripts, json). Used to purge everything for a meeting on delete.
  meetingPrefix(sessionId: string): string {
    return path.posix.join(this.basePath(), "meetings", sessionId) + "/";
  }

  // Best-effort delete of every blob under a prefix. Returns the count removed.
  // Individual failures are swallowed so one bad blob doesn't abort the purge.
  async deleteByPrefix(prefix: string): Promise<number> {
    const container = this.serviceClient.getContainerClient(env.AZURE_STORAGE_CONTAINER);
    let deleted = 0;
    for await (const blob of container.listBlobsFlat({ prefix })) {
      const ok = await container
        .deleteBlob(blob.name, { deleteSnapshots: "include" })
        .then(() => true)
        .catch(() => false);
      if (ok) deleted += 1;
    }
    return deleted;
  }

  // Purge the recording, thumbnail and any other stored artifacts for a session.
  async deleteMeetingArtifacts(sessionId: string): Promise<number> {
    return this.deleteByPrefix(this.meetingPrefix(sessionId));
  }

  thumbnailBlobName(sessionId: string): string {
    return path.posix.join(this.basePath(), "meetings", sessionId, "thumbnails", "thumbnail.jpg");
  }

  private basePath(): string {
    return env.AZURE_STORAGE_BASE_PATH.replace(/^\/+|\/+$/g, "");
  }

  // Store the token-less blob URL (it encodes the blob path). The storage
  // account blocks anonymous public access, so the path alone isn't readable —
  // a short-lived read SAS is minted on demand at serve time via
  // signBlobReadUrl(), which re-signs on every request so links never expire.
  private blobUrl(blobClient: BlockBlobClient): string {
    return blobClient.url;
  }
}

function sharedKeyFromConnectionString(connectionString: string): StorageSharedKeyCredential | undefined {
  const parts: Record<string, string> = {};
  for (const part of connectionString.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    parts[part.slice(0, separator)] = part.slice(separator + 1);
  }
  if (!parts.AccountName || !parts.AccountKey) return undefined;
  return new StorageSharedKeyCredential(parts.AccountName, parts.AccountKey);
}

let cachedSharedKey: StorageSharedKeyCredential | null | undefined;
function getSharedKey(): StorageSharedKeyCredential | undefined {
  if (cachedSharedKey === undefined) {
    cachedSharedKey = env.AZURE_STORAGE_CONNECTION_STRING
      ? sharedKeyFromConnectionString(env.AZURE_STORAGE_CONNECTION_STRING) ?? null
      : null;
  }
  return cachedSharedKey ?? undefined;
}

// Re-sign a stored blob URL with a fresh read-only SAS so the frontend can
// fetch private recordings/thumbnails. Strips any pre-existing (possibly
// expired) query string and appends a new token. Returns the input unchanged
// when storage/credentials aren't configured or the URL can't be parsed, so it
// is always safe to call on whatever is stored.
export function signBlobReadUrl(storedUrl: string | undefined | null): string | undefined {
  if (!storedUrl) return storedUrl ?? undefined;
  const sharedKey = getSharedKey();
  if (!sharedKey) return storedUrl;

  let parsed: URL;
  try {
    parsed = new URL(storedUrl);
  } catch {
    return storedUrl;
  }

  const segments = parsed.pathname.replace(/^\/+/, "").split("/");
  const containerName = segments.shift();
  const blobName = segments.join("/");
  if (!containerName || !blobName) return storedUrl;

  const startsOn = new Date(Date.now() - 60_000);
  const expiresOn = new Date(Date.now() + env.AZURE_STORAGE_SAS_EXPIRES_HOURS * 60 * 60 * 1000);
  const sas = generateBlobSASQueryParameters(
    {
      containerName,
      blobName: decodeURIComponent(blobName),
      permissions: BlobSASPermissions.parse("r"),
      startsOn,
      expiresOn
    },
    sharedKey
  ).toString();

  return `${parsed.origin}${parsed.pathname}?${sas}`;
}
