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
