/**
 * Japanese dictionary lookup over the imported Yomitan terms.
 *
 * A plain dictionary query fails on real text, because what is on the page is
 * almost never the dictionary form: 育てられた must find 育てる, 読まなかった
 * must find 読む. Yomitan's own answer is a deinflection table; ours is the
 * tokenizer that is already in the reader for furigana, which returns the
 * basic form directly and is far more accurate than suffix-stripping.
 *
 * The tokenizer lives inside the reader WebView, so callers pass in whatever
 * base forms they already have. A small suffix fallback covers the case where
 * no tokenizer is available yet.
 */
import { getDictDb } from "./yomitan-import";

export interface Definition {
  dictionary: string;
  expression: string;
  reading: string;
  glossary: string;
  score: number;
}

/**
 * English endings, with the stem forms to try. English text gets no help from
 * the reader's tokenizer — it only analyses Japanese — so a plain lookup of
 * "running" or "tried" would miss entirely.
 */
const ENGLISH_RULES: [RegExp, string[]][] = [
  [/ies$/, ["y"]],
  [/ied$/, ["y"]],
  [/ier$/, ["y"]],
  [/iest$/, ["y"]],
  [/ves$/, ["f", "fe"]],
  [/([^aeiou])\1(ing|ed|er|est)$/, ["$1"]], // running -> run
  [/ing$/, ["", "e"]], // walking -> walk, making -> make
  [/ed$/, ["", "e"]], // walked -> walk, liked -> like
  [/es$/, ["", "e"]],
  [/s$/, [""]],
  [/est$/, ["", "e"]],
  [/er$/, ["", "e"]],
  [/ly$/, [""]],
];

function englishStems(word: string): string[] {
  const out: string[] = [];
  for (const [pattern, replacements] of ENGLISH_RULES) {
    const match = pattern.exec(word);
    if (!match) continue;
    for (const replacement of replacements) {
      const stem = word.replace(pattern, replacement.replace("$1", match[1] ?? ""));
      if (stem.length >= 2) out.push(stem);
    }
  }
  return out;
}

/** Endings stripped when no tokenizer answer is available. Longest first. */
const FALLBACK_SUFFIXES = [
  "られませんでした", "させられました", "られました", "させました", "ませんでした",
  "なかった", "られない", "させない", "ています", "ました", "まして", "られる",
  "させる", "ません", "たい", "ない", "ます", "った", "って", "んで", "んだ",
  "いて", "いで", "ta", "て", "た", "る", "り", "い", "く", "け", "し",
];

function candidatesFor(surface: string, baseForms: string[]): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };

  push(surface);
  for (const base of baseForms) push(base);

  // Only guess when the tokenizer gave us nothing to go on.
  if (baseForms.length === 0) {
    // Latin script means English: try its inflections before the Japanese ones.
    if (/^[A-Za-z][A-Za-z'\-]*$/.test(surface)) {
      const lower = surface.toLowerCase();
      push(lower);
      for (const stem of englishStems(lower)) push(stem);
    }
    for (const suffix of FALLBACK_SUFFIXES) {
      if (surface.length > suffix.length && surface.endsWith(suffix)) {
        push(surface.slice(0, surface.length - suffix.length));
        push(`${surface.slice(0, surface.length - suffix.length)}る`);
      }
    }
  }
  return out;
}

/**
 * Look a word up. `baseForms` are dictionary forms already known for the
 * surface, e.g. from the reader's tokenizer.
 */
export async function lookup(
  surface: string,
  baseForms: string[] = [],
  limit = 12,
): Promise<Definition[]> {
  const words = candidatesFor(surface, baseForms);
  if (words.length === 0) return [];

  const db = await getDictDb();
  const placeholders = words.map(() => "?").join(", ");
  const rows = await db.getAllAsync<{
    title: string; expression: string; reading: string | null;
    glossary: string; score: number;
  }>(
    `SELECT d.title AS title, t.expression, t.reading, t.glossary, t.score
       FROM terms t
       JOIN dictionaries d ON d.id = t.dictionary_id
      WHERE t.expression IN (${placeholders}) OR t.reading IN (${placeholders})
      ORDER BY t.score DESC
      LIMIT ?`,
    ...words, ...words, limit,
  );

  // Exact surface matches first: a reader who selected 育てられた wants that
  // verb, not every word that happens to share its reading.
  const rank = (expression: string) => {
    const at = words.indexOf(expression);
    return at === -1 ? words.length : at;
  };

  return rows
    .map((r) => ({
      dictionary: r.title,
      expression: r.expression,
      reading: r.reading ?? "",
      glossary: r.glossary,
      score: r.score,
    }))
    .sort((a, b) => rank(a.expression) - rank(b.expression) || b.score - a.score);
}

export async function hasDictionaries(): Promise<boolean> {
  const db = await getDictDb();
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(*) AS n FROM dictionaries");
  return (row?.n ?? 0) > 0;
}

/** One word found inside a longer selection, with what the dictionaries say. */
export interface PhraseHit {
  surface: string;
  entries: Definition[];
}

const JAPANESE_CHAR =
  /[ぁ-ゟ゠-ヿ々〇㐀-䶿一-鿿豈-﫿]/;
const SINGLE_KANA = /^[ぁ-ゟ゠-ヿ]$/;
const SEGMENT_BREAK = /[\s、。「」『』（）()！？!?・…―ー〜,.:;"']/;

/** Longest word we will try to match in one step. */
const MAX_TOKEN_LENGTH = 8;
/** SQLite allows 999 bound variables; stay well under it. */
const QUERY_BATCH = 400;
/** Enough of a sentence to gloss without turning into a wall of entries. */
const MAX_PHRASE_LENGTH = 200;

/**
 * Which of these candidate strings actually exist in the dictionaries, either
 * as a headword or as a reading.
 */
async function knownSurfaces(candidates: string[]): Promise<Set<string>> {
  const db = await getDictDb();
  const known = new Set<string>();
  for (let i = 0; i < candidates.length; i += QUERY_BATCH) {
    const batch = candidates.slice(i, i + QUERY_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = await db.getAllAsync<{ expression: string; reading: string | null }>(
      `SELECT DISTINCT expression, reading FROM terms
        WHERE expression IN (${placeholders}) OR reading IN (${placeholders})`,
      ...batch,
      ...batch,
    );
    const wanted = new Set(batch);
    for (const row of rows) {
      if (wanted.has(row.expression)) known.add(row.expression);
      if (row.reading && wanted.has(row.reading)) known.add(row.reading);
    }
  }
  return known;
}

/**
 * Gloss a whole selection word by word.
 *
 * Japanese writes no spaces, so the words have to be found before they can be
 * looked up. The reader does that with kuromoji, but a web page has no
 * tokenizer behind it, so the dictionary segments the text itself: at each
 * position take the longest run that is a real headword, and move past it.
 * That is cruder than a morphological analyser and quite good enough to gloss
 * a sentence someone has just selected.
 *
 * Bare particles are dropped. A list that opens with は and を is noise, and
 * nobody selected a sentence to be told what を means.
 */
export async function lookupPhrase(text: string, limit = 12): Promise<PhraseHit[]> {
  const source = text.trim().slice(0, MAX_PHRASE_LENGTH);
  if (!source) return [];

  let surfaces: string[];

  if (!JAPANESE_CHAR.test(source)) {
    surfaces = source
      .split(/[^A-Za-z'\-]+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 1);
  } else {
    const candidates: string[] = [];
    for (let i = 0; i < source.length; i += 1) {
      if (SEGMENT_BREAK.test(source[i])) continue;
      for (let length = Math.min(MAX_TOKEN_LENGTH, source.length - i); length > 0; length -= 1) {
        const slice = source.slice(i, i + length);
        if (!SEGMENT_BREAK.test(slice)) candidates.push(slice);
      }
    }
    const known = await knownSurfaces([...new Set(candidates)]);

    surfaces = [];
    let i = 0;
    while (i < source.length) {
      if (SEGMENT_BREAK.test(source[i])) {
        i += 1;
        continue;
      }
      let matched = 0;
      for (let length = Math.min(MAX_TOKEN_LENGTH, source.length - i); length > 0; length -= 1) {
        const slice = source.slice(i, i + length);
        if (!known.has(slice)) continue;
        if (length === 1 && SINGLE_KANA.test(slice)) continue;
        surfaces.push(slice);
        matched = length;
        break;
      }
      i += matched || 1;
    }
  }

  const ordered = [...new Set(surfaces)].slice(0, limit);
  const hits: PhraseHit[] = [];
  for (const surface of ordered) {
    const entries = await lookup(surface, [], 4);
    if (entries.length > 0) hits.push({ surface, entries });
  }
  return hits;
}
