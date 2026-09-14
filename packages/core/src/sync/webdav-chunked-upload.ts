/**
 * Chunked upload for Nextcloud/ownCloud servers.
 *
 * A single PUT is fine until something in the middle of the connection has an
 * opinion about how big a request may be. Cloudflare's free plan rejects
 * anything over 100 MB with a 413 before the request ever reaches the server,
 * which is how a 298 MB book can fail to upload while the server logs nothing
 * at all — it never heard about it.
 *
 * Nextcloud's answer is to take the file as a sequence of small uploads and
 * assemble them server-side:
 *
 *   MKCOL  /remote.php/dav/uploads/<user>/<id>     create an upload session
 *   PUT    /remote.php/dav/uploads/<user>/<id>/00001   one chunk
 *   PUT    …/00002                                      …
 *   MOVE   /remote.php/dav/uploads/<user>/<id>/.file → the real destination
 *
 * Each chunk is an ordinary small request, so nothing in the path objects.
 */

/** Comfortably under the 100 MB limit that prompted this, with room for overhead. */
export const DEFAULT_CHUNK_SIZE = 20 * 1024 * 1024;

/**
 * Files at or below this go up in one PUT. Chunking costs extra round trips and
 * a server-side assembly step, so it is not worth it for ordinary books.
 */
export const CHUNKED_UPLOAD_THRESHOLD = 50 * 1024 * 1024;

export interface ChunkedUploadTarget {
  /** Root for upload sessions, e.g. https://host/remote.php/dav/uploads/helye */
  uploadsRoot: string;
  /** Absolute destination URL of the finished file. */
  destinationUrl: string;
}

/**
 * Work out where upload sessions live for a `/remote.php/dav/files/<user>` base
 * URL. Anything else is not a Nextcloud-shaped server, so chunking is not
 * available and the caller keeps its plain PUT.
 */
export function deriveUploadsRoot(baseUrl: string): string | null {
  const match = baseUrl.match(/^(.*)\/remote\.php\/dav\/files\/([^/]+)(?:\/.*)?$/);
  if (!match) return null;
  const [, origin, user] = match;
  return `${origin}/remote.php/dav/uploads/${user}`;
}

/** Chunk names sort as strings on the server, so they must be zero padded. */
export function chunkName(index: number): string {
  return String(index + 1).padStart(5, "0");
}

export function planChunks(
  totalSize: number,
  chunkSize: number = DEFAULT_CHUNK_SIZE,
): { index: number; offset: number; length: number }[] {
  if (totalSize <= 0) return [];
  const chunks: { index: number; offset: number; length: number }[] = [];
  let offset = 0;
  let index = 0;
  while (offset < totalSize) {
    const length = Math.min(chunkSize, totalSize - offset);
    chunks.push({ index, offset, length });
    offset += length;
    index += 1;
  }
  return chunks;
}

/** A session id that cannot collide with another device uploading the same book. */
export function newUploadId(): string {
  return `readany-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function shouldChunk(totalSize: number | null | undefined): boolean {
  return typeof totalSize === "number" && totalSize > CHUNKED_UPLOAD_THRESHOLD;
}

/** A 413 is the whole reason this module exists; recognise it wherever it shows up. */
export function isPayloadTooLarge(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    if ((error as { status?: number }).status === 413) return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /\b413\b|payload too large|request entity too large/i.test(message);
}
