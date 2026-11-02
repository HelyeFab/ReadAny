/**
 * Reading a file's bytes on the phone, so it can be hashed.
 *
 * The hashing itself lives in core (`hashFileSha256`) and knows nothing about
 * platforms; this supplies the only part that must: how to read a range of a
 * file. Expo's `FileHandle` gives us exactly that, and reading in ranges is
 * what makes hashing a 300 MB textbook possible at all — `file.bytes()` would
 * pull the whole thing into memory first.
 *
 * Used by two callers that must agree with each other and with the desktop:
 * import de-duplication, and the sync adapter's cover comparison.
 */
import { type ChunkedFileReader, hashFileSha256 } from "@readany/core";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";

/**
 * Below this, hash natively in one shot; above it, walk the file in chunks.
 *
 * ⚠️ The chunked walk is pure-JS SHA-256 on the JS thread. That is the right
 * tool for a 300 MB textbook, which cannot be buffered at all — and the wrong
 * one for a 60 KB cover. `syncFiles` hashes EVERY local cover in a single
 * unbounded `Promise.all`, so on a 374-book library the JS path meant hundreds
 * of concurrent JS digests and open file handles competing for the one thread,
 * and a sync that locked the UI. Upstream never had this because it used the
 * native digest; it simply hashed the wrong bytes (the base64 TEXT), which is
 * why this code stopped using it. `Crypto.digest` gives us both: native, and
 * over the raw bytes, so the result still matches the desktop.
 */
const NATIVE_DIGEST_MAX_BYTES = 16 * 1024 * 1024;

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

/** SHA-256 over bytes already in memory, computed natively. */
async function digestBytes(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer: expo-crypto types the input as BufferSource,
  // which excludes a view backed by a SharedArrayBuffer.
  const view = new Uint8Array(bytes.byteLength);
  view.set(bytes);
  return toHex(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, view.buffer));
}

/** A reader over a file on disk. The handle stays open for the walk. */
export function createExpoChunkedReader(
  filePath: string,
  size: number,
): { reader: ChunkedFileReader; close: () => void } {
  const handle = new File(filePath).open();

  return {
    reader: {
      size,
      readRange: async (offset, length) => {
        handle.offset = offset;
        return handle.readBytes(length);
      },
    },
    close: () => {
      try {
        handle.close();
      } catch {
        // Closing a handle we have finished with is not worth failing an import over.
      }
    },
  };
}

/**
 * SHA-256 of a book file, matching what the desktop writes for the same file.
 *
 * Returns `undefined` rather than throwing: a hash we could not compute costs
 * us a duplicate check, which is not a reason to fail the import.
 */
export async function hashBookFile(
  filePath: string,
  size: number,
  onProgress?: (bytesHashed: number, totalBytes: number) => void,
): Promise<string | undefined> {
  if (!Number.isFinite(size) || size <= 0) return undefined;

  if (size <= NATIVE_DIGEST_MAX_BYTES) {
    try {
      const hash = await digestBytes(await new File(filePath).bytes());
      onProgress?.(size, size);
      return hash;
    } catch (err) {
      // Fall through to the chunked walk: a file we could not buffer is
      // exactly what that path is for.
      console.warn("[Library] Native file hash failed, falling back to chunks:", err);
    }
  }

  let close: (() => void) | undefined;
  try {
    const opened = createExpoChunkedReader(filePath, size);
    close = opened.close;
    return await hashFileSha256(opened.reader, { onProgress });
  } catch (err) {
    console.warn("[Library] File hash calculation failed:", err);
    return undefined;
  } finally {
    close?.();
  }
}

/**
 * SHA-256 of any file on disk, as lowercase hex. Throws if it cannot be read —
 * callers that would rather have no hash than an error should use
 * {@link hashBookFile}.
 */
export async function hashFileAtPath(filePath: string): Promise<string> {
  const file = new File(filePath);
  const size = file.size;
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`Cannot hash ${filePath}: unknown size`);
  }

  // The sync path comes through here, for every cover at once. Keep it native.
  if (size <= NATIVE_DIGEST_MAX_BYTES) {
    return digestBytes(await file.bytes());
  }

  const { reader, close } = createExpoChunkedReader(filePath, size);
  try {
    return await hashFileSha256(reader);
  } finally {
    close();
  }
}
