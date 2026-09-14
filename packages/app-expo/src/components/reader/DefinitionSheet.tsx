import type { Definition, PhraseHit } from "@/lib/dictionary/lookup";
import { radius, spacing, ui, useColors } from "@/styles/theme";
/**
 * Definitions for the selected word, from the imported Yomitan dictionaries.
 *
 * Deliberately a plain sheet rather than a dialog: looking a word up while
 * reading should cost one tap to open and one to dismiss, and should never
 * take the page away.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface Props {
  visible: boolean;
  word: string;
  baseForms: string[];
  onClose: () => void;
}

export function DefinitionSheet({ visible, word, baseForms, onClose }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const [entries, setEntries] = useState<Definition[] | null>(null);
  /** Word-by-word gloss, used when the selection is a phrase rather than a word. */
  const [phrase, setPhrase] = useState<PhraseHit[]>([]);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    if (!visible || !word) return;
    let cancelled = false;
    setEntries(null);
    setPhrase([]);
    void (async () => {
      try {
        const { lookup, lookupPhrase, hasDictionaries } = await import("@/lib/dictionary/lookup");
        const any = await hasDictionaries();
        const found = any ? await lookup(word, baseForms) : [];
        // Selecting a sentence and being told "no entry found" is a true answer
        // to a question nobody asked. If the whole selection is not itself a
        // headword, gloss the words inside it instead.
        const hits =
          any && found.length === 0 && word.trim().length > 2 ? await lookupPhrase(word) : [];
        if (!cancelled) {
          setInstalled(any);
          setEntries(found);
          setPhrase(hits);
        }
      } catch (err) {
        console.error("[Dictionary] lookup failed:", err);
        if (!cancelled) setEntries([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, word, baseForms]);

  const addToAnki = async (term: string, defs: Definition[]) => {
    if (defs.length === 0) return;
    try {
      const { sendToAnki, cardFromDefinitions, AnkiUnavailableError } = await import(
        "@/lib/anki/send-to-anki"
      );
      await sendToAnki(cardFromDefinitions(term, defs));
      onClose();
    } catch (err) {
      const { AnkiUnavailableError: Unavailable } = await import("@/lib/anki/send-to-anki");
      Alert.alert(
        t("anki.title", "Add to Anki"),
        err instanceof Unavailable
          ? t("anki.notInstalled", "AnkiDroid does not appear to be installed.")
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  };

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={onClose} />
      <View
        style={{
          maxHeight: "60%",
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.sm,
        }}
      >
        <Text
          style={{
            fontSize: word.length > 24 ? 15 : 22,
            fontWeight: "600",
            color: colors.foreground,
          }}
          numberOfLines={2}
        >
          {word}
        </Text>
        {baseForms.length > 0 && baseForms[0] !== word && (
          <Text style={{ fontSize: ui(13), color: colors.mutedForeground }}>
            {baseForms.join(" · ")}
          </Text>
        )}

        {entries !== null && entries.length > 0 && (
          <TouchableOpacity
            onPress={() => void addToAnki(word, entries)}
            style={{
              alignSelf: "flex-start",
              backgroundColor: colors.primary,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              paddingVertical: 8,
            }}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>
              {t("anki.add", "Add to Anki")}
            </Text>
          </TouchableOpacity>
        )}

        {entries === null ? (
          <ActivityIndicator style={{ marginVertical: spacing.lg }} color={colors.primary} />
        ) : !installed ? (
          <Text style={{ color: colors.mutedForeground }}>
            {t(
              "dictionary.noneInstalled",
              "No dictionaries installed. Add one in Settings → Dictionaries.",
            )}
          </Text>
        ) : entries.length === 0 && phrase.length > 0 ? (
          <ScrollView>
            <Text
              style={{ color: colors.mutedForeground, fontSize: ui(12), marginBottom: spacing.sm }}
            >
              {t("dictionary.phraseGloss", "Words in this selection")}
            </Text>
            {phrase.map((hit, i) => (
              <View
                key={`${hit.surface}-${i}`}
                style={{
                  paddingVertical: spacing.sm,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
                  <Text style={{ fontSize: ui(17), fontWeight: "600", color: colors.foreground }}>
                    {hit.surface}
                  </Text>
                  {hit.entries[0]?.reading && hit.entries[0].reading !== hit.surface ? (
                    <Text style={{ fontSize: ui(13), color: colors.mutedForeground }}>
                      {hit.entries[0].reading}
                    </Text>
                  ) : null}
                  <View style={{ flex: 1 }} />
                  <TouchableOpacity onPress={() => void addToAnki(hit.surface, hit.entries)}>
                    <Text style={{ fontSize: ui(12), color: colors.primary }}>
                      {t("anki.add", "Add to Anki")}
                    </Text>
                  </TouchableOpacity>
                </View>
                {hit.entries.map((entry, j) => (
                  <Text
                    key={`${entry.dictionary}-${j}`}
                    style={{ fontSize: ui(14), color: colors.foreground, marginTop: 3 }}
                  >
                    {entry.glossary}
                  </Text>
                ))}
              </View>
            ))}
          </ScrollView>
        ) : entries.length === 0 ? (
          <Text style={{ color: colors.mutedForeground }}>
            {t("dictionary.noMatch", "No entry found.")}
          </Text>
        ) : (
          <ScrollView>
            {entries.map((entry, i) => (
              <View
                key={`${entry.dictionary}-${entry.expression}-${i}`}
                style={{
                  paddingVertical: spacing.sm,
                  borderTopWidth: i === 0 ? 0 : 1,
                  borderTopColor: colors.border,
                }}
              >
                <Text style={{ fontSize: ui(16), color: colors.foreground }}>
                  {entry.expression}
                  {entry.reading && entry.reading !== entry.expression
                    ? `（${entry.reading}）`
                    : ""}
                </Text>
                <Text style={{ fontSize: ui(14), color: colors.foreground, marginTop: 2 }}>
                  {entry.glossary}
                </Text>
                <Text style={{ fontSize: ui(11), color: colors.mutedForeground, marginTop: 4 }}>
                  {entry.dictionary}
                </Text>
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
