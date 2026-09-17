/**
 * Bionic reading — bolding the front of each word as a fixation point.
 *
 * The eye does not read a word letter by letter; it lands once and the brain
 * completes the rest. Emboldening the opening characters gives it somewhere
 * deliberate to land, and Emmanuel has read this way in Moon+ Reader for
 * years. This is that, for our reader.
 *
 * ⚠️ Latin script only, on purpose. The idea depends on a word having a
 * beginning that can be distinguished from its remainder, which is a property
 * of alphabetic writing. Japanese and Chinese have no such front to bold, and
 * a book's Japanese passages already carry ruby — so non-Latin runs are left
 * exactly as they are, and a mixed book gets bionic English beside untouched
 * Japanese rather than a choice between them.
 *
 * The text logic here is pure and separately tested; the DOM half below is
 * deliberately thin, and mirrors the ruby injector in the reader template so
 * the two behave the same way about what they refuse to touch.
 */

/** Marks a span this feature created, so it can be found and undone. */
export const BIONIC_PROCESSED_ATTR = "data-readany-bionic";
export const BIONIC_STYLE_ID = "readany-bionic-style";

/**
 * Runs of Latin letters, including accents and the apostrophes inside words,
 * so "don't" and "naïve" are single words rather than three and two.
 */
const WORD_RE = /[\p{Script=Latin}\p{Mn}ʼ'’]+/gu;

/** A word worth bolding has at least one actual letter in it. */
const HAS_LETTER_RE = /\p{Script=Latin}/u;

export interface BionicToken {
  /** The opening characters to embolden. Empty for text that is left alone. */
  bold: string;
  /** The remainder, shown normally. */
  rest: string;
}

/**
 * How many characters of a word to embolden.
 *
 * Never more than half the word, and proportionally less as words get longer,
 * so the bold stays a pointer to the word rather than becoming the word. A
 * short word gets one character: "the" emboldened past its first letter is
 * just bold text.
 */
export function bionicBoldLength(word: string): number {
  const length = word.length;
  if (length <= 1) return length;
  if (length <= 3) return 1;
  if (length <= 5) return 2;
  if (length <= 7) return 3;
  if (length <= 9) return 4;
  return Math.ceil(length * 0.4);
}

/**
 * Split text into tokens, losslessly.
 *
 * Every character of the input appears exactly once in the output, so the
 * original text can always be reassembled by concatenating `bold + rest` in
 * order. Anything that is not a Latin word — spaces, punctuation, digits, CJK
 * — comes back as a token with nothing emboldened.
 */
export function splitBionicText(text: string): BionicToken[] {
  if (!text) return [];

  const tokens: BionicToken[] = [];
  let cursor = 0;

  WORD_RE.lastIndex = 0;
  let match = WORD_RE.exec(text);
  while (match !== null) {
    const word = match[0];
    const start = match.index;

    if (start > cursor) {
      tokens.push({ bold: "", rest: text.slice(cursor, start) });
    }

    if (HAS_LETTER_RE.test(word)) {
      const boldLength = bionicBoldLength(word);
      tokens.push({ bold: word.slice(0, boldLength), rest: word.slice(boldLength) });
    } else {
      // An apostrophe on its own is not a word.
      tokens.push({ bold: "", rest: word });
    }

    cursor = start + word.length;
    match = WORD_RE.exec(text);
  }

  if (cursor < text.length) {
    tokens.push({ bold: "", rest: text.slice(cursor) });
  }

  return tokens;
}

/** Whether a piece of text has anything for this feature to do. */
export function hasBionicCandidates(text: string): boolean {
  return HAS_LETTER_RE.test(text);
}

/**
 * The bold weight is set relative to the surrounding text rather than to a
 * fixed value, so a book that already renders in a heavy face does not end up
 * with a bold that cannot be told apart from its body text.
 */
export const BIONIC_CSS = `
[${BIONIC_PROCESSED_ATTR}],
[${BIONIC_PROCESSED_ATTR}] b {
  display: contents;
}
[${BIONIC_PROCESSED_ATTR}] b {
  font-weight: inherit;
  -webkit-text-stroke: 0.35px currentColor;
  text-shadow: 0.2px 0 currentColor;
}
`;

/**
 * Elements this feature must not reach inside.
 *
 * Mirrors the ruby injector's rules, plus the places where emboldening would
 * be actively wrong: code, where weight carries no meaning and monospace
 * alignment does; and anything already bolded, which would be indistinguishable
 * from the fixation point.
 */
const SKIP_SELECTOR = `.readany-translation, ruby, rt, rp, script, style, code, pre, kbd, samp, b, strong, [${BIONIC_PROCESSED_ATTR}]`;

const BLOCK_SELECTOR = "p, h1, h2, h3, h4, h5, h6, li, blockquote, dd, dt, figcaption, td, th, div";

function shouldSkip(el: Element): boolean {
  return typeof el.closest === "function" && el.closest(SKIP_SELECTOR) !== null;
}

function injectStyles(doc: Document): void {
  const existing = doc.getElementById(BIONIC_STYLE_ID);
  if (existing) {
    existing.textContent = BIONIC_CSS;
    return;
  }
  const style = doc.createElement("style");
  style.id = BIONIC_STYLE_ID;
  style.textContent = BIONIC_CSS;
  (doc.head || doc.documentElement)?.appendChild(style);
}

/**
 * Embolden the front of every Latin word in the document.
 *
 * Returns the number of text nodes rewritten. Idempotent: a node already
 * rewritten sits inside a marked span, which `shouldSkip` refuses, so calling
 * this twice does not bold the bold.
 */
export function applyBionicReading(doc: Document): number {
  if (!doc) return 0;
  injectStyles(doc);

  let count = 0;
  const blocks = doc.querySelectorAll(BLOCK_SELECTOR);

  for (const block of Array.from(blocks)) {
    const blockText = block.textContent;
    if (!blockText || !blockText.trim()) continue;
    if (shouldSkip(block)) continue;
    if (!hasBionicCandidates(blockText)) continue;

    const walker = doc.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode(node: Node) {
        const value = node.nodeValue;
        if (!value || !value.trim()) return NodeFilter.FILTER_SKIP;
        if (!hasBionicCandidates(value)) return NodeFilter.FILTER_SKIP;
        const parent = (node as Text).parentElement;
        if (!parent) return NodeFilter.FILTER_ACCEPT;
        return shouldSkip(parent) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });

    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
      textNodes.push(node as Text);
      node = walker.nextNode();
    }

    for (const textNode of textNodes) {
      const text = textNode.nodeValue || "";
      const tokens = splitBionicText(text);
      if (tokens.every((token) => !token.bold)) continue;

      const span = doc.createElement("span");
      span.setAttribute(BIONIC_PROCESSED_ATTR, "true");
      for (const token of tokens) {
        if (token.bold) {
          const bold = doc.createElement("b");
          bold.textContent = token.bold;
          span.appendChild(bold);
        }
        if (token.rest) span.appendChild(doc.createTextNode(token.rest));
      }

      textNode.parentNode?.replaceChild(span, textNode);
      count++;
    }
  }

  return count;
}

/**
 * Disable the bold fixation points without replacing any nodes.
 *
 * Annotation CFIs and rendered ranges can point inside these wrappers. Keeping
 * the DOM intact means toggling bionic reading cannot invalidate a highlight.
 */
export function removeBionicReading(doc: Document): void {
  if (!doc) return;
  const style = doc.getElementById(BIONIC_STYLE_ID);
  if (style) {
    style.textContent = `
[${BIONIC_PROCESSED_ATTR}],
[${BIONIC_PROCESSED_ATTR}] b {
  display: contents;
}
[${BIONIC_PROCESSED_ATTR}] b {
  font-weight: inherit;
}`;
  }
}

/** Install on the reader webview's global, the way the justified-text engine is. */
export function installReadAnyBionicReading(root: unknown): void {
  const target = (root ?? {}) as Record<string, unknown>;
  target.ReadAnyBionicReading = {
    apply: (doc: Document) => applyBionicReading(doc),
    remove: (doc: Document) => removeBionicReading(doc),
    splitBionicText,
    BIONIC_PROCESSED_ATTR,
  };
}
