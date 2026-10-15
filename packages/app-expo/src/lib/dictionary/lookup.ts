/**
 * Dictionary lookup over the imported terms (Yomitan and StarDict).
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
import { foldTerm } from "./fold";
import { SYNONYM_RULE } from "./stardict-import";
import { getDictDb } from "./yomitan-import";

export interface Definition {
  dictionary: string;
  expression: string;
  reading: string;
  glossary: string;
  score: number;
}

/**
 * Latin-script endings, with the stem forms to try. These languages get no
 * help from the reader's tokenizer — it only analyses Japanese — so a plain
 * lookup of "running", "chevaux" or "luces" would miss entirely. The rules are
 * English first, plus the commonest French and Spanish plurals. A rule that is
 * wrong for the language at hand only produces a candidate that is either not
 * in the dictionary or ranked below the word as written.
 */
const LATIN_RULES: [RegExp, string[]][] = [
  [/eaux$/, ["eau"]], // châteaux -> château
  [/aux$/, ["al"]], // chevaux -> cheval
  [/ces$/, ["z"]], // luces -> luz
  [/x$/, [""]], // jeux -> jeu
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

function latinStems(word: string): string[] {
  const out: string[] = [];
  for (const [pattern, replacements] of LATIN_RULES) {
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

/** Letters of the alphabetic scripts: Latin with its accents, Greek, Cyrillic, Hangul. */
const WORD_LETTERS =
  "A-Za-z\\u00C0-\\u00D6\\u00D8-\\u00F6\\u00F8-\\u024F\\u0300-\\u036F\\u0370-\\u03FF\\u0400-\\u052F\\u1E00-\\u1EFF\\uAC00-\\uD7AF";
// biome-ignore lint/suspicious/noMisleadingCharacterClass: accents may arrive as separate combining marks
const LATIN_WORD = /^[A-Za-z\u00C0-\u024F\u1E00-\u1EFF][A-Za-z\u00C0-\u024F\u1E00-\u1EFF\u0300-\u036F'’-]*$/;
const NON_WORD = new RegExp(`[^${WORD_LETTERS}'’\\-]+`);

/**
 * French and Italian fuse an article or pronoun onto the next word: l'homme,
 * d'accord, qu'il, dell'acqua. The word worth looking up is the part after.
 */
const ELISION = /^[a-z]{1,6}['’](.{2,})$/i;

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
    // Latin script: try the word without its elided article, then its
    // inflections, before the Japanese ones.
    if (LATIN_WORD.test(surface)) {
      const lower = surface.toLowerCase();
      push(lower);
      const elided = ELISION.exec(lower);
      if (elided) push(elided[1]);
      for (const word of elided ? [lower, elided[1]] : [lower]) {
        for (const stem of latinStems(word)) push(stem);
      }
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

  // Folded copies catch capitals and missing accents: Été finds été, and
  // a dictionary that writes cafe still answers café.
  const folded = [...new Set(words.map(foldTerm))];

  const db = await getDictDb();
  const placeholders = words.map(() => "?").join(", ");
  const foldedPlaceholders = folded.map(() => "?").join(", ");
  const found = await db.getAllAsync<{
    dictionary_id: number; title: string; expression: string; reading: string | null;
    glossary: string; score: number; rules: string | null;
  }>(
    `SELECT t.dictionary_id, d.title AS title, t.expression, t.reading, t.glossary, t.score, t.rules
       FROM terms t
       JOIN dictionaries d ON d.id = t.dictionary_id
      WHERE t.expression IN (${placeholders}) OR t.reading IN (${placeholders})
         OR t.folded IN (${foldedPlaceholders})
      ORDER BY t.score DESC
      LIMIT ?`,
    ...words, ...words, ...folded, limit,
  );

  // A StarDict inflection (allions) points at its headword (aller): show the
  // headword's own entries in its place.
  // `matched` is the form the query hit, which is what ranking goes by.
  const rows: (typeof found[number] & { matched: string })[] = [];
  for (const row of found) {
    if (row.rules !== SYNONYM_RULE) {
      rows.push({ ...row, matched: row.expression });
      continue;
    }
    const targets = await db.getAllAsync<typeof found[number]>(
      `SELECT t.dictionary_id, ? AS title, t.expression, t.reading, t.glossary, t.score, t.rules
         FROM terms t
        WHERE t.dictionary_id = ? AND t.expression = ? AND t.rules IS NOT ?
        LIMIT 3`,
      row.title, row.dictionary_id, row.glossary, SYNONYM_RULE,
    );
    for (const target of targets) {
      const duplicate = rows.some(
        (r) => r.dictionary_id === target.dictionary_id && r.expression === target.expression && r.glossary === target.glossary,
      );
      // Ranked as the form that was looked up, not as the headword.
      if (!duplicate) rows.push({ ...target, score: row.score, matched: row.expression });
    }
  }

  // Exact surface matches first: a reader who selected 育てられた wants that
  // verb, not every word that happens to share its reading. A folded match
  // ranks behind every exact one.
  const rank = (expression: string) => {
    const at = words.indexOf(expression);
    if (at !== -1) return at;
    const foldedAt = folded.indexOf(foldTerm(expression));
    return foldedAt === -1 ? words.length * 2 : words.length + foldedAt;
  };

  return rows
    .sort((a, b) => rank(a.matched) - rank(b.matched) || b.score - a.score)
    .map((r) => ({
      dictionary: r.title,
      expression: r.expression,
      reading: r.reading ?? "",
      glossary: r.glossary,
      score: r.score,
    }));
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
      .split(NON_WORD)
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
