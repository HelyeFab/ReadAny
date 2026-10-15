/**
 * Import a StarDict dictionary.
 *
 * StarDict is the format with the widest free supply for languages other than
 * Japanese — it is what KOReader, GoldenDict and ColorDict read, and most
 * bilingual dictionaries for French, Spanish, Italian, German … exist in it.
 * One dictionary is a set of files sharing a name:
 *
 *   name.ifo        text header: bookname, wordcount, sametypesequence …
 *   name.idx(.gz)   headword, NUL, offset (32- or 64-bit BE), size (32-bit BE)
 *   name.dict(.dz)  the definitions; .dz is gzip with a random-access header,
 *                   which a plain gunzip reads fine
 *   name.syn        optional: extra lookup forms (inflections, variants), each
 *                   pointing at an .idx entry
 *
 * The .syn file matters more than its "optional" suggests: StarDict has no
 * deinflection rules, so for French or Spanish it is the only way chevaux
 * finds cheval. Wiktionary's French set lists 424k such forms against 79k
 * headwords, so each is stored as a pointer — glossary = the headword, rules =
 * SYNONYM_RULE — and resolved at lookup time, rather than copying the whole
 * article half a million times.
 *
 * An archive may hold several dictionaries; each .ifo is imported separately.
 */
import { gunzipSync, strFromU8 } from "fflate";
import type { FileMap } from "./archive";
import {
  type DictionaryInfo,
  type TermInput,
  createDictionary,
  insertTerms,
  setTermCount,
} from "./yomitan-import";

/** Marks a term whose glossary is the headword it points at, not a definition. */
export const SYNONYM_RULE = "stardict-syn";

/** Terms per transaction; also how often progress is reported. */
const CHUNK = 2000;

export function isStarDict(files: FileMap): boolean {
  return Object.keys(files).some((n) => n.toLowerCase().endsWith(".ifo"));
}

interface IfoHeader {
  bookname: string;
  version: string;
  sameTypeSequence: string;
  offsetBits: 32 | 64;
}

function parseIfo(text: string): IfoHeader {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const at = line.indexOf("=");
    if (at > 0) fields[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return {
    bookname: fields.bookname || "Untitled dictionary",
    version: fields.version ?? "",
    sameTypeSequence: fields.sametypesequence ?? "",
    offsetBits: fields.idxoffsetbits === "64" ? 64 : 32,
  };
}

/** The file whose name is `stem` plus one of `extensions`, inflated if gzipped. */
function companion(files: FileMap, stem: string, extensions: string[]): Uint8Array | null {
  const lowerStem = stem.toLowerCase();
  for (const name of Object.keys(files)) {
    const lower = name.toLowerCase();
    for (const ext of extensions) {
      if (lower !== `${lowerStem}${ext}`) continue;
      const bytes = files[name];
      return ext.endsWith(".gz") || ext.endsWith(".dz") ? gunzipSync(bytes) : bytes;
    }
  }
  return null;
}

interface IdxEntry {
  word: string;
  offset: number;
  size: number;
}

function readUint32(bytes: Uint8Array, at: number): number {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}

function parseIdx(bytes: Uint8Array, offsetBits: 32 | 64): IdxEntry[] {
  const entries: IdxEntry[] = [];
  const offsetSize = offsetBits / 8;
  let pos = 0;
  while (pos < bytes.length) {
    let end = pos;
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    if (end + 1 + offsetSize + 4 > bytes.length) break;
    const word = strFromU8(bytes.subarray(pos, end));
    pos = end + 1;
    const offset =
      offsetSize === 8
        ? readUint32(bytes, pos) * 2 ** 32 + readUint32(bytes, pos + 4)
        : readUint32(bytes, pos);
    pos += offsetSize;
    const size = readUint32(bytes, pos);
    pos += 4;
    entries.push({ word, offset, size });
  }
  return entries;
}

/** .syn: word, NUL, index into the .idx entries (32-bit BE). */
function parseSyn(bytes: Uint8Array): { word: string; index: number }[] {
  const out: { word: string; index: number }[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    let end = pos;
    while (end < bytes.length && bytes[end] !== 0) end += 1;
    if (end + 5 > bytes.length) break;
    out.push({ word: strFromU8(bytes.subarray(pos, end)), index: readUint32(bytes, end + 1) });
    pos = end + 5;
  }
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

/** HTML, Pango and XDXF all reduce to readable lines the same way. */
function markupToText(markup: string): string {
  return (
    decodeEntities(
      markup
        // XDXF repeats the headword inside the article; the sheet already shows it.
        .replace(/<k>[\s\S]*?<\/k>/gi, "")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<li[^>]*>/gi, "\n• ")
        .replace(/<\/(p|div|li|tr|h\d|def|blockquote)>/gi, "\n")
        .replace(/<[^>]+>/g, ""),
    )
      .split("\n")
      .map((line) => line.trim())
      // Blank lines too: every <li> also closes with one, which double-spaces lists.
      .filter(Boolean)
      .join("\n")
      .trim()
  );
}

/**
 * Decode one article. Lowercase type letters are NUL-terminated text, upper
 * case ones are a 32-bit size followed by binary data (sound, images) that a
 * text sheet cannot show. With `sametypesequence` the type letters are left
 * out of the data and the last field simply runs to the end.
 */
function parseArticle(
  data: Uint8Array,
  sameTypeSequence: string,
): { reading: string; text: string } {
  const parts: string[] = [];
  let reading = "";
  let pos = 0;

  const take = (type: string, isLast: boolean) => {
    if (type >= "A" && type <= "Z") {
      const size = isLast ? data.length - pos : readUint32(data, pos);
      pos += isLast ? size : 4 + size;
      return;
    }
    let end = pos;
    if (isLast) end = data.length;
    else while (end < data.length && data[end] !== 0) end += 1;
    const value = strFromU8(data.subarray(pos, end)).replace(/\0+$/, "");
    pos = end + 1;

    if (type === "t") reading = value.trim();
    else if (type === "h" || type === "g" || type === "x") parts.push(markupToText(value));
    else if (type !== "r") parts.push(value.trim());
  };

  if (sameTypeSequence) {
    for (let i = 0; i < sameTypeSequence.length && pos < data.length; i += 1) {
      take(sameTypeSequence[i], i === sameTypeSequence.length - 1);
    }
  } else {
    while (pos < data.length) {
      const type = String.fromCharCode(data[pos]);
      pos += 1;
      take(type, false);
    }
  }
  return { reading, text: parts.filter(Boolean).join("\n") };
}

/** Import every StarDict dictionary among the files. */
export async function importStarDictFiles(
  files: FileMap,
  onProgress?: (done: number, total: number, title: string) => void,
): Promise<DictionaryInfo[]> {
  const ifoNames = Object.keys(files).filter((n) => n.toLowerCase().endsWith(".ifo"));
  const imported: DictionaryInfo[] = [];

  for (const ifoName of ifoNames) {
    const stem = ifoName.slice(0, -".ifo".length);
    const header = parseIfo(strFromU8(files[ifoName]));
    const idx = companion(files, stem, [".idx", ".idx.gz", ".idx.dz"]);
    const dict = companion(files, stem, [".dict", ".dict.dz", ".dict.gz"]);
    if (!idx || !dict) {
      throw new Error(
        `${header.bookname}: the .idx and .dict files must be imported together with the .ifo`,
      );
    }
    const syn = companion(files, stem, [".syn", ".syn.dz", ".syn.gz"]);

    const entries = parseIdx(idx, header.offsetBits);
    // A narrowed copy: the null check above does not reach into a generator.
    const articleBytes: Uint8Array = dict;
    const synonyms = syn ? parseSyn(syn) : [];

    // Articles are decoded as each chunk is written, never all at once:
    // English Wiktionary is 850k terms and ~50M characters of definitions,
    // which held in memory together is more than a phone will give an app.
    function* allTerms(): Generator<TermInput> {
      for (const entry of entries) {
        const article = parseArticle(
          articleBytes.subarray(entry.offset, entry.offset + entry.size),
          header.sameTypeSequence,
        );
        yield {
          expression: entry.word,
          reading: article.reading,
          rules: "",
          score: 0,
          glossary: article.text,
        };
      }
      for (const synonym of synonyms) {
        const target = entries[synonym.index];
        if (!target || synonym.word === target.word) continue;
        yield {
          expression: synonym.word,
          // The headword's own reading arrives when the pointer is resolved.
          reading: "",
          rules: SYNONYM_RULE,
          // Below real headwords, so a form that is also a word in its own
          // right shows its own entry first.
          score: -1,
          glossary: target.word,
        };
      }
    }

    const dictId = await createDictionary(header.bookname, header.version);
    const total = entries.length + synonyms.length;
    let termCount = 0;
    let seen = 0;
    let chunk: TermInput[] = [];
    for (const term of allTerms()) {
      chunk.push(term);
      seen += 1;
      if (chunk.length >= CHUNK) {
        termCount += await insertTerms(dictId, chunk);
        chunk = [];
        onProgress?.(seen, total, header.bookname);
      }
    }
    termCount += await insertTerms(dictId, chunk);
    onProgress?.(total, total, header.bookname);
    await setTermCount(dictId, termCount);
    imported.push({
      id: dictId,
      title: header.bookname,
      revision: header.version,
      termCount,
      importedAt: Date.now(),
    });
  }
  return imported;
}
