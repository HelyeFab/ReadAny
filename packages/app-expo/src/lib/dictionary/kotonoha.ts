/**
 * Kotonoha — Emmanuel's own Japanese dictionary (kotonoha.appsparkle.org) — as
 * the main source for Japanese lookups.
 *
 * It answers conjugated forms itself (育てられた → 育てる) and its entries are
 * better curated than an imported JMdict, but it is a network service behind a
 * home server, so it must never block the sheet: the imported dictionaries
 * answer instantly and offline, and Kotonoha's entries are placed on top when
 * they arrive. Results are cached for the session.
 */
import type { Definition } from "./lookup";

export const KOTONOHA_BASE_URL = "https://kotonoha.appsparkle.org";
export const KOTONOHA_DICTIONARY_NAME = "Kotonoha";

const TIMEOUT_MS = 12_000;
const MAX_ENTRIES = 4;
const CACHE_LIMIT = 200;

export interface KotonohaDefinition extends Definition {
  /** Full entry page, for the "Open in Kotonoha" link. */
  url: string;
}

interface KotonohaEntry {
  id: string;
  word: string;
  reading: string;
  meaning: string;
  type?: string;
}

const JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

/** Kotonoha only knows Japanese; anything without kana or kanji is not asked. */
export function isKotonohaQuery(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 100 && JAPANESE_RE.test(trimmed);
}

export function kotonohaEntryUrl(entry: { id: string; word: string; reading: string }): string {
  const params = new URLSearchParams({ word: entry.word, reading: entry.reading });
  return `${KOTONOHA_BASE_URL}/word/${encodeURIComponent(entry.id)}?${params.toString()}`;
}

export function toDefinitions(entries: KotonohaEntry[]): KotonohaDefinition[] {
  return entries
    .filter((e) => e && e.word && e.meaning)
    .slice(0, MAX_ENTRIES)
    .map((e, i) => ({
      dictionary: KOTONOHA_DICTIONARY_NAME,
      expression: e.word,
      reading: e.reading ?? "",
      glossary: e.type ? `${e.meaning}\n${e.type}` : e.meaning,
      // above every imported entry, in Kotonoha's own order
      score: 1_000_000 - i,
      url: kotonohaEntryUrl(e),
    }));
}

const cache = new Map<string, KotonohaDefinition[]>();

async function search(q: string): Promise<KotonohaEntry[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${KOTONOHA_BASE_URL}/api/search?q=${encodeURIComponent(q)}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Kotonoha HTTP ${res.status}`);
    const body = (await res.json()) as { entries?: KotonohaEntry[] };
    return Array.isArray(body.entries) ? body.entries : [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Look a Japanese word up in Kotonoha. Tries the word as it appears on the page
 * first (Kotonoha deinflects), then the tokenizer's base form. Throws on network
 * failure so the caller can say Kotonoha is unreachable; returns [] for no match.
 */
export async function lookupKotonoha(
  surface: string,
  baseForms: string[] = [],
): Promise<KotonohaDefinition[]> {
  const candidates = [...new Set([surface.trim(), ...baseForms.map((b) => b.trim())])].filter(
    isKotonohaQuery,
  );
  if (candidates.length === 0) return [];
  const key = candidates.join("|");
  const cached = cache.get(key);
  if (cached) return cached;

  let found: KotonohaDefinition[] = [];
  for (const q of candidates) {
    found = toDefinitions(await search(q));
    if (found.length > 0) break;
  }
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(key, found);
  return found;
}
