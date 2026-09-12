/**
 * Definitions for the selected word, from the imported Yomitan dictionaries.
 *
 * Deliberately a plain sheet rather than a dialog: looking a word up while
 * reading should cost one tap to open and one to dismiss, and should never
 * take the page away.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { Definition } from "@/lib/dictionary/lookup";
import { radius, spacing, useColors } from "@/styles/theme";

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
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    if (!visible || !word) return;
    let cancelled = false;
    setEntries(null);
    void (async () => {
      try {
        const { lookup, hasDictionaries } = await import("@/lib/dictionary/lookup");
        const any = await hasDictionaries();
        const found = any ? await lookup(word, baseForms) : [];
        if (!cancelled) {
          setInstalled(any);
          setEntries(found);
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
        <Text style={{ fontSize: 22, fontWeight: "600", color: colors.foreground }}>{word}</Text>
        {baseForms.length > 0 && baseForms[0] !== word && (
          <Text style={{ fontSize: 13, color: colors.mutedForeground }}>
            {baseForms.join(" · ")}
          </Text>
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
                <Text style={{ fontSize: 16, color: colors.foreground }}>
                  {entry.expression}
                  {entry.reading && entry.reading !== entry.expression
                    ? `（${entry.reading}）`
                    : ""}
                </Text>
                <Text style={{ fontSize: 14, color: colors.foreground, marginTop: 2 }}>
                  {entry.glossary}
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 4 }}>
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
