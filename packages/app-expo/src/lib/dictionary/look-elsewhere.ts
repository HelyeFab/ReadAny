/**
 * Look a word up outside the app: in another installed app, or on the web.
 *
 * Imported dictionaries cover the languages someone has bothered to install a
 * dictionary for. Everything else — a French novel with no French dictionary,
 * a word the dictionary lacks, a phrase that needs translating rather than
 * defining — needs a way out that costs one tap.
 *
 * Two routes:
 *
 * - Other apps, through Android's PROCESS_TEXT intent: the same mechanism that
 *   puts "Translate" and "Look up" into the system text-selection menu. Google
 *   Translate, DeepL, GoldenDict and ColorDict all answer it, so whatever the
 *   reader already has installed works with no setup, offline if that app is.
 * - The web, with the reader choosing service and languages at lookup time.
 *   The target language is remembered; the source follows the book.
 */
import { getPlatformService } from "@readany/core/services";
import * as IntentLauncher from "expo-intent-launcher";
import { Linking, Platform } from "react-native";

const PROCESS_TEXT = "android.intent.action.PROCESS_TEXT";
const EXTRA_PROCESS_TEXT = "android.intent.extra.PROCESS_TEXT";
const EXTRA_PROCESS_TEXT_READONLY = "android.intent.extra.PROCESS_TEXT_READONLY";

export class NoTextAppError extends Error {}

export const canUseTextApps = Platform.OS === "android";

/**
 * Hand the text to whichever app the reader picks. Android shows its own
 * chooser when several apps answer, and remembers "always" if asked to.
 */
export async function openInTextApp(text: string): Promise<void> {
  if (!canUseTextApps) throw new NoTextAppError("Only available on Android");
  try {
    await IntentLauncher.startActivityAsync(PROCESS_TEXT, {
      type: "text/plain",
      extra: {
        [EXTRA_PROCESS_TEXT]: text,
        // Read-only: the book cannot take a replacement back, so apps that
        // offer to rewrite the selection should not.
        [EXTRA_PROCESS_TEXT_READONLY]: true,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/no activity|not found|resolve/i.test(message)) {
      throw new NoTextAppError("No installed app accepts text to look up");
    }
    throw err;
  }
}

/** Languages offered in the pickers, named in their own language. */
export const LANGUAGES: { code: string; name: string }[] = [
  { code: "en", name: "English" },
  { code: "fr", name: "Français" },
  { code: "es", name: "Español" },
  { code: "it", name: "Italiano" },
  { code: "de", name: "Deutsch" },
  { code: "pt", name: "Português" },
  { code: "nl", name: "Nederlands" },
  { code: "ru", name: "Русский" },
  { code: "ja", name: "日本語" },
  { code: "zh", name: "中文" },
  { code: "ko", name: "한국어" },
];

/** "auto" lets the service detect the source; not every service can. */
export const AUTO = "auto";

export function languageName(code: string): string {
  return LANGUAGES.find((l) => l.code === code)?.name ?? code;
}

/** Book metadata says "fr-FR", "fre", "French" …; reduce it to a code we offer. */
export function normaliseLanguage(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  const primary = value.split(/[-_]/)[0];
  if (LANGUAGES.some((l) => l.code === primary)) return primary;
  const byName = LANGUAGES.find((l) => l.name.toLowerCase() === value);
  if (byName) return byName.code;
  const ISO_639_2: Record<string, string> = {
    eng: "en",
    fre: "fr",
    fra: "fr",
    spa: "es",
    ita: "it",
    ger: "de",
    deu: "de",
    por: "pt",
    dut: "nl",
    nld: "nl",
    rus: "ru",
    jpn: "ja",
    chi: "zh",
    zho: "zh",
    kor: "ko",
    english: "en",
    french: "fr",
    spanish: "es",
    italian: "it",
    german: "de",
    portuguese: "pt",
    dutch: "nl",
    russian: "ru",
    japanese: "ja",
    chinese: "zh",
    korean: "ko",
  };
  return ISO_639_2[value] ?? ISO_639_2[primary] ?? null;
}

/** When the book does not say, the script of the text often does. */
export function guessLanguage(text: string): string | null {
  if (/[\u3040-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";
  return null;
}

export interface WebService {
  id: string;
  name: string;
  /** Null when this service cannot handle the language pair. */
  url: (text: string, from: string, to: string) => string | null;
}

/** WordReference pairs English with these; its codes differ from ISO in places. */
const WORDREFERENCE: Record<string, string> = {
  es: "es",
  fr: "fr",
  it: "it",
  de: "de",
  pt: "pt",
  nl: "nl",
  ru: "ru",
  ja: "ja",
  zh: "zh",
  ko: "ko",
};

export const WEB_SERVICES: WebService[] = [
  {
    id: "google",
    name: "Google Translate",
    url: (text, from, to) =>
      `https://translate.google.com/?sl=${from}&tl=${to}&text=${encodeURIComponent(text)}&op=translate`,
  },
  {
    id: "deepl",
    name: "DeepL",
    url: (text, from, to) =>
      from === AUTO
        ? null
        : `https://www.deepl.com/translator#${from}/${to}/${encodeURIComponent(text)}`,
  },
  {
    // The target language picks the edition: en.wiktionary explains a French
    // word in English, fr.wiktionary explains it in French.
    id: "wiktionary",
    name: "Wiktionary",
    url: (text, _from, to) =>
      `https://${to}.wiktionary.org/wiki/${encodeURIComponent(text.trim())}`,
  },
  {
    id: "wordreference",
    name: "WordReference",
    url: (text, from, to) => {
      const pair =
        from === "en" && WORDREFERENCE[to]
          ? `en${WORDREFERENCE[to]}`
          : to === "en" && WORDREFERENCE[from]
            ? `${WORDREFERENCE[from]}en`
            : null;
      return pair
        ? `https://www.wordreference.com/${pair}/${encodeURIComponent(text.trim())}`
        : null;
    },
  },
  {
    id: "jisho",
    name: "Jisho",
    url: (text, from) =>
      from === "ja" ? `https://jisho.org/search/${encodeURIComponent(text.trim())}` : null,
  },
];

export async function openWebLookup(url: string): Promise<void> {
  await Linking.openURL(url);
}

const PREFS_KEY = "dictionary_web_lookup_prefs";

export interface WebLookupPrefs {
  /** Last target language chosen. */
  to: string;
}

export async function loadWebLookupPrefs(fallbackTo: string): Promise<WebLookupPrefs> {
  try {
    const raw = await getPlatformService().kvGetItem(PREFS_KEY);
    const value = raw ? (JSON.parse(raw) as Partial<WebLookupPrefs>) : {};
    const to = normaliseLanguage(value.to) ?? normaliseLanguage(fallbackTo) ?? "en";
    return { to };
  } catch {
    return { to: normaliseLanguage(fallbackTo) ?? "en" };
  }
}

export async function saveWebLookupPrefs(prefs: WebLookupPrefs): Promise<void> {
  try {
    await getPlatformService().kvSetItem(PREFS_KEY, JSON.stringify(prefs));
  } catch (error) {
    // Forgetting the language is a nuisance, not a failed lookup.
    console.warn("[Dictionary] Failed to remember web lookup language:", error);
  }
}
