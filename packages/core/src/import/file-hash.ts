/**
 * File hashing for import de-duplication.
 *
 * The library already knows how to skip a book it has seen before: the import
 * flow builds an index over `book.fileHash` and drops anything whose hash is
 * already there. What it lacked was a hash. Desktop gets one from Rust
 * (`sync_hash_file`, SHA-256 over the file's bytes); mobile returned
 * `undefined` and the whole apparatus sat idle.
 *
 * ⚠️ The algorithm is not a free choice. The `books` table syncs, so a hash
 * written on the desktop lands on the phone and vice versa. Anything other
 * than lowercase-hex SHA-256 over the raw bytes would give the same file two
 * different identities on two devices, and a book synced from one and
 * re-imported on the other would slip through as a duplicate.
 *
 * There is no native streaming SHA-256 on Expo — `expo-crypto` hashes a buffer
 * in one shot and `expo-file-system` offers only MD5 — so a 300 MB textbook
 * cannot be hashed by reading it into memory. Instead the file is walked in
 * chunks and fed to an incremental hasher. The reading is left to the caller
 * (`ChunkedFileReader`) so the loop itself stays pure and testable.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

/** 4 MiB — big enough to keep the number of native reads low, small enough not to spike memory. */
export const FILE_HASH_CHUNK_BYTES = 4 * 1024 * 1024;

/** Minimal random-access view of a file. Implemented per platform. */
export interface ChunkedFileReader {
  /** Total size in bytes. */
  size: number;
  /**
   * Read up to `length` bytes starting at `offset`. May return fewer bytes at
   * the end of the file; returning an empty array ends the walk.
   */
  readRange(offset: number, length: number): Promise<Uint8Array>;
}

export interface HashFileOptions {
  chunkBytes?: number;
  /** Called after each chunk with bytes hashed so far, for progress reporting. */
  onProgress?: (bytesHashed: number, totalBytes: number) => void;
  /**
   * Awaited between chunks so a long hash does not starve the UI thread.
   * Defaults to yielding to the macrotask queue.
   */
  yieldBetweenChunks?: () => Promise<void>;
}

function defaultYield(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * SHA-256 of a file's bytes, as lowercase hex — the same string the desktop's
 * `sync_hash_file` produces for the same file.
 */
export async function hashFileSha256(
  reader: ChunkedFileReader,
  options: HashFileOptions = {},
): Promise<string> {
  const {
    chunkBytes = FILE_HASH_CHUNK_BYTES,
    onProgress,
    yieldBetweenChunks = defaultYield,
  } = options;

  if (!Number.isFinite(reader.size) || reader.size < 0) {
    throw new Error(`Cannot hash a file of unknown size (got ${reader.size})`);
  }
  if (!Number.isFinite(chunkBytes) || chunkBytes <= 0) {
    throw new Error(`chunkBytes must be a positive number (got ${chunkBytes})`);
  }

  const hasher = sha256.create();
  let offset = 0;

  while (offset < reader.size) {
    const wanted = Math.min(chunkBytes, reader.size - offset);
    const chunk = await reader.readRange(offset, wanted);

    // A short read is normal at the tail; an empty one means the file ended
    // earlier than its reported size, which we treat as the end of the walk
    // rather than spinning forever.
    if (chunk.length === 0) break;

    hasher.update(chunk);
    offset += chunk.length;

    onProgress?.(offset, reader.size);
    if (offset < reader.size) await yieldBetweenChunks();
  }

  return bytesToHex(hasher.digest());
}
