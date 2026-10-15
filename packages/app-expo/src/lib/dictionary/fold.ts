/**
 * Fold a word to the form it is matched under.
 *
 * A word on the page rarely has the exact shape of the headword: it opens a
 * sentence (Città, Été), or it is set in capitals, or the dictionary writes it
 * without the accent the book used. Each term is stored with a folded copy —
 * lower case, combining accents removed — and lookups try that column too, so
 * those near-misses still land. Exact matches are ranked first, so folding
 * only ever adds answers; it never displaces the precise one.
 *
 * Japanese, Chinese and Korean are left untouched. Decomposing them is not
 * folding: が splits into か plus a dakuten mark, and Hangul splits into its
 * jamo, both of which would turn real words into strings no dictionary holds.
 */

/** Scripts whose text must never be decomposed. */
const CJK = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\uac00-\ud7af\u1100-\u11ff]/;

// biome-ignore lint/suspicious/noMisleadingCharacterClass: matching combining marks is the point
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Used when the engine has no String.prototype.normalize. Covers the accented
 * letters of the European languages a reader is likely to meet.
 */
const LATIN_FALLBACK: Record<string, string> = {
  à: "a",
  á: "a",
  â: "a",
  ã: "a",
  ä: "a",
  å: "a",
  ā: "a",
  ă: "a",
  ą: "a",
  ç: "c",
  ć: "c",
  č: "c",
  ď: "d",
  è: "e",
  é: "e",
  ê: "e",
  ë: "e",
  ē: "e",
  ė: "e",
  ę: "e",
  ě: "e",
  ì: "i",
  í: "i",
  î: "i",
  ï: "i",
  ī: "i",
  į: "i",
  ñ: "n",
  ń: "n",
  ň: "n",
  ò: "o",
  ó: "o",
  ô: "o",
  õ: "o",
  ö: "o",
  ō: "o",
  ő: "o",
  ř: "r",
  ś: "s",
  š: "s",
  ş: "s",
  ť: "t",
  ţ: "t",
  ù: "u",
  ú: "u",
  û: "u",
  ü: "u",
  ū: "u",
  ů: "u",
  ű: "u",
  ų: "u",
  ý: "y",
  ÿ: "y",
  ź: "z",
  ż: "z",
  ž: "z",
};

function stripAccents(text: string): string {
  try {
    return text.normalize("NFD").replace(COMBINING_MARKS, "").normalize("NFC");
  } catch {
    return text.replace(/[\u0080-\uffff]/g, (ch) => LATIN_FALLBACK[ch] ?? ch);
  }
}

export function foldTerm(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || CJK.test(trimmed)) return trimmed;
  return stripAccents(trimmed.toLowerCase());
}
