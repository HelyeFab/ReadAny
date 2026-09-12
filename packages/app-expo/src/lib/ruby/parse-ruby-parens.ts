/**
 * Turn 漢字（かんじ） into ruby segments.
 *
 * Sensei glosses every kanji word with its reading in parentheses, because that
 * survives a streaming markdown pipeline that has no HTML in it. This module is
 * the other half: it finds those glosses again so the chat can draw them as
 * stacked furigana instead of leaving parentheses in the prose.
 *
 * The reading covers the whole word, so 育てられた（そだてられた） has to be
 * split before it is drawn — ruby goes over the kanji stem only, and the
 * okurigana stays on the baseline where it already reads correctly.
 */

const KANJI = "\\u3005\\u3007\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF";
const KANA = "\\u3041-\\u309F\\u30A0-\\u30FF\\u31F0-\\u31FF\\u30FC";

const KANA_CHAR = new RegExp(`^[${KANA}]$`);

/**
 * A word starts at a kanji and may run on into okurigana, immediately followed
 * by a kana-only parenthetical. Starting at the kanji matters: allowing leading
 * kana would let the match reach back into the previous word.
 */
const RUBY_PATTERN = new RegExp(
  `[${KANJI}][${KANJI}${KANA}]*[（(]([${KANA}]+)[)）]`,
  "g",
);

export type RubySegment =
  | { kind: "text"; text: string }
  | { kind: "ruby"; base: string; reading: string; prefix: string; suffix: string };

function isKana(char: string): boolean {
  return KANA_CHAR.test(char);
}

/** Katakana readings fold to hiragana so they can be matched against okurigana. */
function toHiragana(input: string): string {
  let out = "";
  for (const char of input) {
    const code = char.charCodeAt(0);
    out += code >= 0x30a1 && code <= 0x30f6 ? String.fromCharCode(code - 0x60) : char;
  }
  return out;
}

/**
 * Peel the kana tail off the word and off its reading, so ruby lands on the
 * kanji stem. Returns null when nothing is left to put ruby on.
 */
function splitOkurigana(
  word: string,
  reading: string,
): { base: string; reading: string; prefix: string; suffix: string } | null {
  let end = word.length;
  let suffix = "";
  while (end > 0 && isKana(word[end - 1])) {
    suffix = word[end - 1] + suffix;
    end -= 1;
  }

  const base = word.slice(0, end);
  if (!base) return null;

  let stemReading = reading;
  const suffixKana = toHiragana(suffix);
  if (suffixKana && toHiragana(stemReading).endsWith(suffixKana)) {
    stemReading = stemReading.slice(0, stemReading.length - suffixKana.length);
  }
  if (!stemReading || stemReading === base) return null;

  return { base, reading: stemReading, prefix: "", suffix };
}

export function hasRubyParens(input: string): boolean {
  RUBY_PATTERN.lastIndex = 0;
  return RUBY_PATTERN.test(input);
}

export function parseRubyParens(input: string): RubySegment[] {
  const segments: RubySegment[] = [];
  let cursor = 0;

  RUBY_PATTERN.lastIndex = 0;
  let match = RUBY_PATTERN.exec(input);
  while (match) {
    const whole = match[0];
    const reading = match[1];
    const word = whole.slice(0, whole.length - reading.length - 2);
    const split = splitOkurigana(word, reading);

    if (split) {
      if (match.index > cursor) {
        segments.push({ kind: "text", text: input.slice(cursor, match.index) });
      }
      segments.push({ kind: "ruby", ...split });
      cursor = match.index + whole.length;
    }

    match = RUBY_PATTERN.exec(input);
  }

  if (cursor < input.length) {
    segments.push({ kind: "text", text: input.slice(cursor) });
  }

  return segments;
}
