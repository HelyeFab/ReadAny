/**
 * Reading a book's bytes on the phone, so it can be hashed.
 *
 * The hashing itself lives in core (`hashFileSha256`) and knows nothing about
 * platforms; this supplies the only part that must: how to read a range of a
 * file. Expo's `FileHandle` gives us exactly that, and reading in ranges is
 * what makes hashing a 300 MB textbook possible at all — `file.bytes()` would
 * pull the whole thing into memory first.
 */
import { type ChunkedFileReader, hashFileSha256 } from "@readany/core";
import { File } from "expo-file-system";

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
