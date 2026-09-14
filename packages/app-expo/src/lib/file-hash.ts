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

  const { reader, close } = createExpoChunkedReader(filePath, size);
  try {
    return await hashFileSha256(reader);
  } finally {
    close();
  }
}
