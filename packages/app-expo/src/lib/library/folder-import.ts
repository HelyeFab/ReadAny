/**
 * Recursive folder import (Android).
 *
 * The document picker can multi-select files but cannot select a FOLDER, so a
 * shelf of books has to be tapped in one by one. Android's Storage Access
 * Framework can grant a directory, which this walks.
 *
 * SAF gives no "is directory" flag in a listing, so each child is probed once.
 * The walk is depth-limited because a user can quite reasonably grant something
 * enormous, like the whole of internal storage.
 */
import * as FileSystem from "expo-file-system/legacy";

export const IMPORTABLE_EXTENSIONS = [
  ".epub", ".pdf", ".mobi", ".azw", ".azw3", ".fb2", ".fbz", ".cbz", ".txt", ".umd",
];

const MAX_DEPTH = 6;
const MAX_FILES = 2000;

export interface FolderCandidate {
  uri: string;
  name: string;
}

/** SAF URIs carry the display name in their last encoded segment. */
export function displayNameFromSafUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep the raw form: a name is better than nothing
  }
  const tail = decoded.split(/[/:]/).pop() || decoded;
  return tail.trim() || "book";
}

export function isImportable(name: string): boolean {
  const lower = name.toLowerCase();
  return IMPORTABLE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Ask for a folder and return every importable file inside it.
 * Returns null if the user declined.
 */
export async function pickFolderBooks(
  onProgress?: (found: number, scanned: number) => void,
): Promise<FolderCandidate[] | null> {
  const permission =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const found: FolderCandidate[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  const walk = async (dirUri: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || found.length >= MAX_FILES) return;

    let children: string[];
    try {
      children = await FileSystem.StorageAccessFramework.readDirectoryAsync(dirUri);
    } catch {
      return; // unreadable subtree — skip it rather than abandon the import
    }

    for (const child of children) {
      if (found.length >= MAX_FILES) return;
      if (seen.has(child)) continue;
      seen.add(child);
      scanned += 1;

      const name = displayNameFromSafUri(child);
      if (isImportable(name)) {
        found.push({ uri: child, name });
        onProgress?.(found.length, scanned);
        continue;
      }

      // No type flag in the listing, so probe. Anything with a known book
      // extension was handled above, so this only costs time on odd files.
      try {
        const info = await FileSystem.getInfoAsync(child);
        if (info.exists && info.isDirectory) {
          await walk(child, depth + 1);
        }
      } catch {
        // not a directory, or not readable
      }
      onProgress?.(found.length, scanned);
    }
  };

  await walk(permission.directoryUri, 0);
  return found;
}
