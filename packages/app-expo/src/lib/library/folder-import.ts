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
  /**
   * Folders between the chosen root and this file, outermost first.
   *
   * A shelf that arrives as one flat heap is not the shelf you picked. The
   * import rebuilds this as nested groups, so a library sorted by author on
   * disk stays sorted by author in the app.
   */
  relativeFolder: string[];
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
/**
 * Copy a granted SAF document into the cache and return a file:// URI.
 *
 * The importer reads the file itself, and a content:// URI from a folder grant
 * is not something it can open — importing them directly fails every book.
 */
async function materialise(
  uri: string,
  name: string,
  relativeFolder: string[],
): Promise<FolderCandidate> {
  const target = `${FileSystem.cacheDirectory}folder-import/${Date.now()}-${name}`;
  await FileSystem.makeDirectoryAsync(`${FileSystem.cacheDirectory}folder-import`, {
    intermediates: true,
  }).catch(() => undefined);
  await FileSystem.copyAsync({ from: uri, to: target });
  return { uri: target, name, relativeFolder };
}

export interface FolderPick {
  /** The chosen folder's own name — the obvious default for a new shelf. */
  folderName: string;
  candidates: FolderCandidate[];
}

export async function pickFolderBooks(
  onProgress?: (found: number, scanned: number) => void,
): Promise<FolderPick | null> {
  const permission =
    await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;

  const found: FolderCandidate[] = [];
  const seen = new Set<string>();
  let scanned = 0;

  const walk = async (dirUri: string, depth: number, path: string[]): Promise<void> => {
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
        try {
          found.push(await materialise(child, name, path));
        } catch {
          // unreadable file — skip it rather than failing the whole folder
        }
        onProgress?.(found.length, scanned);
        continue;
      }

      // No type flag in a SAF listing, and getInfoAsync does not report
      // isDirectory for SAF child URIs. Listing the child IS the test: it
      // succeeds for a directory and throws for a file.
      try {
        await FileSystem.StorageAccessFramework.readDirectoryAsync(child);
        await walk(child, depth + 1, [...path, name]);
      } catch {
        // a file, or an unreadable subtree
      }
      onProgress?.(found.length, scanned);
    }
  };

  await walk(permission.directoryUri, 0, []);
  return {
    folderName: displayNameFromSafUri(permission.directoryUri),
    candidates: found,
  };
}
