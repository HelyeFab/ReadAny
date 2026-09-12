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

/**
 * Build a card from a dictionary lookup. Front is the word as it appeared;
 * the back carries the dictionary form and readings, because the form on the
 * page is rarely the form worth learning.
 */
export function cardFromDefinitions(
  word: string,
  entries: { expression: string; reading: string; glossary: string; dictionary: string }[],
): AnkiCard {
  const lines: string[] = [];
  for (const entry of entries.slice(0, 3)) {
    const head = entry.reading && entry.reading !== entry.expression
      ? `${entry.expression}（${entry.reading}）`
      : entry.expression;
    lines.push(`${head}\n${entry.glossary}`);
  }
  return { front: word, back: lines.join("\n\n") };
}
