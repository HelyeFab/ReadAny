/**
 * Send a card to AnkiDroid.
 *
 * AnkiDroid answers the OpenIntents flashcard intent, which opens its own Add
 * Note screen prefilled with front and back. That is deliberately what this
 * uses rather than the AnkiDroid content-provider API: the provider needs a
 * runtime permission, a native module, and a chosen deck and note type, and it
 * writes silently. The intent needs none of that, and the card is reviewed by
 * the person adding it before it lands in their collection.
 *
 * AnkiConnect is not an option here — it is a desktop Anki add-on and does not
 * exist on Android.
 */
import { Platform } from "react-native";
import * as IntentLauncher from "expo-intent-launcher";
import { foldTerm } from "@/lib/dictionary/fold";

export const CREATE_FLASHCARD_ACTION = "org.openintents.action.CREATE_FLASHCARD";
export const ANKIDROID_PACKAGE = "com.ichi2.anki";

export interface AnkiCard {
  front: string;
  back: string;
}

export class AnkiUnavailableError extends Error {}

/**
 * Open AnkiDroid's card editor prefilled. Throws AnkiUnavailableError when
 * AnkiDroid is not installed, so callers can say so rather than failing mutely.
 */
export async function sendToAnki({ front, back }: AnkiCard): Promise<void> {
  if (Platform.OS !== "android") {
    throw new AnkiUnavailableError("AnkiDroid export is Android only");
  }
  if (!front.trim()) {
    throw new Error("A card needs a front");
  }

  try {
    await IntentLauncher.startActivityAsync(CREATE_FLASHCARD_ACTION, {
      extra: {
        SOURCE_TEXT: front.trim(),
        TARGET_TEXT: back.trim(),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No activity matched the intent: nothing on the device handles flashcards.
    if (/no activity|not found|resolve/i.test(message)) {
      throw new AnkiUnavailableError("AnkiDroid does not appear to be installed");
    }
    throw err;
  }
}

export interface CardContext {
  /** The sentence on either side of the word, as it appeared on the page. */
  before?: string;
  after?: string;
  /** Where the word was met, usually the book title. */
  source?: string;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Build a card from a dictionary lookup. The front is the sentence the word
 * was met in, with the word in bold, because a word learnt in context sticks
 * far better than a bare one; it falls back to the word alone when the reader
 * could not say what surrounded it. The back starts with the word itself, so
 * the bold on the front can always be found again, then the dictionary form
 * and readings, because the form on the page is rarely the form worth learning.
 */
export function cardFromDefinitions(
  word: string,
  entries: { expression: string; reading: string; glossary: string; dictionary: string }[],
  context: CardContext = {},
): AnkiCard {
  // Lookup also tries guessed stems (morass -> moras), and another language's
  // dictionary can answer one with an unrelated word. When the word itself
  // was found, the guesses do not belong on the card.
  const target = foldTerm(word);
  const exact = entries.filter((entry) => foldTerm(entry.expression) === target);
  const chosen = (exact.length > 0 ? exact : entries).slice(0, 3);

  const lines: string[] = [];
  for (const entry of chosen) {
    const head = entry.reading && entry.reading !== entry.expression
      ? `${entry.expression}（${entry.reading}）`
      : entry.expression;
    lines.push(`${head}\n${entry.glossary}`);
  }

  const before = context.before ?? "";
  const after = context.after ?? "";
  const front = before.trim() || after.trim()
    ? `${escapeHtml(before)}<b>${escapeHtml(word)}</b>${escapeHtml(after)}`.trim()
    : word;
  const source = context.source?.trim() ? `\n\n— ${context.source.trim()}` : "";
  return { front, back: `${lines.join("\n\n")}${source}` };
}
