/**
 * Remembers what a crop said, so reading the same box twice is free.
 *
 * Keyed on the cropped image itself, not on the page address and the rectangle.
 * That is deliberate: sample viewers turn the page without the URL changing at
 * all, so an address-and-rectangle key would confidently serve the previous
 * page's text for the new one. Identical pixels are the only thing that
 * guarantees identical text.
 *
 * The hit rate is modest by nature — you rarely drag exactly the same box — but
 * a miss costs nothing and a hit saves a few seconds and a charged request.
 */
import * as Crypto from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";

const CACHE_DIR_NAME = "ocr-cache";
/** Transcripts are tiny; this is about keeping the directory tidy, not space. */
const MAX_ENTRIES = 400;
const PRUNE_TO = 300;

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.cache, CACHE_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export async function ocrCacheKey(imageBase64: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, imageBase64);
}

export function cachedTranscript(key: string): string | null {
  try {
    const file = new File(cacheDirectory(), `${key}.txt`);
    if (!file.exists) return null;
    const text = file.textSync();
    return text || null;
  } catch {
    return null;
  }
}

export function storeTranscript(key: string, text: string): void {
  if (!text) return;
  try {
    const file = new File(cacheDirectory(), `${key}.txt`);
    if (file.exists) file.delete();
    file.create();
    file.write(text);
    prune();
  } catch {}
}

function prune(): void {
  try {
    const files = cacheDirectory()
      .list()
      .filter((entry): entry is File => entry instanceof File);
    if (files.length <= MAX_ENTRIES) return;
    const oldestFirst = files
      .map((file) => ({ file, at: file.modificationTime ?? 0 }))
      .sort((a, b) => a.at - b.at);
    for (const entry of oldestFirst.slice(0, files.length - PRUNE_TO)) {
      try {
        entry.file.delete();
      } catch {}
    }
  } catch {}
}
