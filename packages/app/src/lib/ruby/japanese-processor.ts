/**
 * Japanese Processor — generates furigana readings for Japanese text.
 *
 * Mirrors pinyin-processor.ts, but where Chinese needs a lookup dictionary this
 * needs a morphological analyser: Japanese has no spaces, and a kanji's reading
 * depends on the word it sits in (生 is せい in 学生, なま in 生ビール, い in 生きる).
 * kuromoji tokenises and returns a katakana reading per token, which we convert
 * to hiragana.
 *
 * Only tokens CONTAINING KANJI get ruby. Kana is already readable, and
 * おじいさん（おじいさん）is noise rather than help.
 */

import type { RubyToken } from "./pinyin-processor";

// kuromoji's IPADIC, as shipped in the npm package.
export const KUROMOJI_DICT_BASE_URL = "https://cdn.jsdelivr.net/npm/kuromoji@0.1.2/dict";

/** The 12 gzipped files kuromoji's loader expects to find in its dict directory. */
export const KUROMOJI_DICT_FILES = [
  "base.dat.gz",
  "cc.dat.gz",
  "check.dat.gz",
  "tid.dat.gz",
  "tid_pos.dat.gz",
  "tid_map.dat.gz",
  "unk.dat.gz",
  "unk_pos.dat.gz",
  "unk_map.dat.gz",
  "unk_char.dat.gz",
  "unk_compat.dat.gz",
  "unk_invoke.dat.gz",
] as const;

const HAS_KANJI = /[㐀-鿿豈-﫿]/;
const KANA_ONLY = /^[぀-ゟ゠-ヿー]+$/;

interface KuromojiToken {
  surface_form: string;
  reading?: string;
}

interface KuromojiTokenizer {
  tokenize(text: string): KuromojiToken[];
}

let _tokenizer: KuromojiTokenizer | null = null;

/** Katakana → hiragana. kuromoji returns readings in katakana; furigana is hiragana. */
export function katakanaToHiragana(input: string): string {
  return input.replace(/[ァ-ヶ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0x60),
  );
}

/**
 * Build the tokenizer from a local dict directory. Called once, after the
 * dictionary has been downloaded.
 */
export async function loadJapaneseTokenizer(dictPath: string): Promise<void> {
  if (_tokenizer) return;
  // kuromoji is CommonJS: under an ESM import the API hides behind `.default`
  // in some bundlers and sits on the namespace in others. Accept either.
  const mod = await import("kuromoji");
  const kuromoji = ((mod as { default?: unknown }).default ?? mod) as {
    builder(opts: { dicPath: string }): {
      build(cb: (err: Error | null, tokenizer: KuromojiTokenizer) => void): void;
    };
  };
  _tokenizer = await new Promise<KuromojiTokenizer>((resolve, reject) => {
    kuromoji.builder({ dicPath: dictPath }).build((err: Error | null, tokenizer: KuromojiTokenizer) => {
      if (err) reject(err);
      else resolve(tokenizer);
    });
  });
}

export function isJapaneseDictLoaded(): boolean {
  return _tokenizer !== null;
}

export function setJapaneseTokenizer(tokenizer: KuromojiTokenizer | null): void {
  _tokenizer = tokenizer;
}

/**
 * Trim the reading down to the kanji portion.
 *
 * kuromoji gives a reading for the whole token, so 育てられた reads
 * ソダテラレタ. Rendering that over the whole token would put かな above かな.
 * The trailing kana in the surface form are already correct, so we strip the
 * matching tail (and any leading kana) and keep ruby on the kanji stem only.
 */
export function trimReadingToKanji(
  surface: string,
  reading: string,
): { char: string; reading: string; suffix: string; prefix: string } {
  let prefix = "";
  let start = 0;
  while (start < surface.length && KANA_ONLY.test(surface[start])) {
    prefix += surface[start];
    start += 1;
  }

  let end = surface.length;
  let suffix = "";
  while (end > start && KANA_ONLY.test(surface[end - 1])) {
    suffix = surface[end - 1] + suffix;
    end -= 1;
  }

  const stem = surface.slice(start, end);
  let stemReading = reading;

  // The reading arrives already folded to hiragana, so a katakana tail such as
  // the ビール of 生ビール will not match the surface form character for
  // character. Fold both sides before trimming.
  const prefixKana = katakanaToHiragana(prefix);
  const suffixKana = katakanaToHiragana(suffix);
  if (prefixKana && stemReading.startsWith(prefixKana)) {
    stemReading = stemReading.slice(prefixKana.length);
  }
  if (suffixKana && stemReading.endsWith(suffixKana)) {
    stemReading = stemReading.slice(0, stemReading.length - suffixKana.length);
  }

  return { char: stem, reading: stemReading, prefix, suffix };
}

/**
 * Annotate Japanese text, returning the same token shape the Chinese path uses
 * so ruby-injector can build identical markup for both languages.
 */
export function annotateJapanese(text: string): RubyToken[] {
  if (!_tokenizer || !text) {
    return [{ char: text, reading: "", needsRuby: false }];
  }

  const tokens: RubyToken[] = [];
  const push = (char: string, reading: string, needsRuby: boolean) => {
    if (!char) return;
    const last = tokens[tokens.length - 1];
    // Merge runs of plain text so the DOM does not fill with one span per token.
    if (last && !needsRuby && !last.needsRuby) {
      last.char += char;
      return;
    }
    tokens.push({ char, reading, needsRuby });
  };

  for (const token of _tokenizer.tokenize(text)) {
    const surface = token.surface_form;
    if (!HAS_KANJI.test(surface) || !token.reading) {
      push(surface, "", false);
      continue;
    }

    const reading = katakanaToHiragana(token.reading);
    const { char, reading: stemReading, prefix, suffix } = trimReadingToKanji(surface, reading);

    if (!char || !stemReading || stemReading === char) {
      push(surface, "", false);
      continue;
    }

    push(prefix, "", false);
    push(char, stemReading, true);
    push(suffix, "", false);
  }

  return tokens;
}
