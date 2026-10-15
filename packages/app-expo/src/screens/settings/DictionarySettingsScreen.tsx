import type { DictionaryInfo } from "@/lib/dictionary/yomitan-import";
import { radius, spacing, ui, useColors } from "@/styles/theme";
import * as DocumentPicker from "expo-document-picker";
/**
 * Dictionaries — import Yomitan packs (the ones the browser extension uses)
 * and StarDict sets (the ones KOReader and GoldenDict use).
 */
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { SettingsHeader } from "./SettingsHeader";

export default function DictionarySettingsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const [dictionaries, setDictionaries] = useState<DictionaryInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { listDictionaries } = await import("@/lib/dictionary/yomitan-import");
    setDictionaries(await listDictionaries());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleImport = useCallback(async () => {
    if (busy) return;
    // Any type, several at once: Android has no MIME type for .ifo or
    // .dict.dz, and a loose StarDict set is three or four files picked together.
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.length) return;

    setBusy(true);
    setProgress(null);
    try {
      const { importDictionaries } = await import("@/lib/dictionary/import");
      const imported = await importDictionaries(
        picked.assets.map((asset) => ({ uri: asset.uri, name: asset.name })),
        (done, total, title) => {
          setProgress(`${title} — ${done}/${total}`);
        },
      );
      await refresh();
      Alert.alert(
        imported.map((info) => info.title).join(", "),
        t("dictionary.imported", "{{count}} entries imported.", {
          count: imported.reduce((sum, info) => sum + info.termCount, 0),
        }),
      );
    } catch (err) {
      Alert.alert(
        t("dictionary.importFailed", "Import failed"),
        err instanceof Error ? err.message : String(err),
      );
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }, [busy, refresh, t]);

  const handleDelete = useCallback(
    async (dict: DictionaryInfo) => {
      const { deleteDictionary } = await import("@/lib/dictionary/yomitan-import");
      await deleteDictionary(dict.id);
      await refresh();
    },
    [refresh],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <SettingsHeader title={t("dictionary.title", "Dictionaries")} />
      <ScrollView contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}>
        <Text style={{ color: colors.mutedForeground, fontSize: ui(13) }}>
          {t(
            "dictionary.description",
            "Import a Yomitan (.zip) or StarDict dictionary. For StarDict, pick the .ifo, .idx and .dict files together, or a .zip / .tar.gz containing them.",
          )}
        </Text>

        <TouchableOpacity
          onPress={handleImport}
          disabled={busy}
          style={{
            backgroundColor: colors.primary,
            borderRadius: radius.md,
            paddingVertical: spacing.md,
            alignItems: "center",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <ActivityIndicator size="small" color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground }}>
                {progress ?? t("dictionary.importing", "Importing…")}
              </Text>
            </View>
          ) : (
            <Text style={{ color: colors.primaryForeground, fontWeight: "600" }}>
              {t("dictionary.import", "Import a dictionary")}
            </Text>
          )}
        </TouchableOpacity>

        {dictionaries.length === 0 && !busy ? (
          <Text style={{ color: colors.mutedForeground }}>
            {t("dictionary.empty", "No dictionaries yet.")}
          </Text>
        ) : (
          dictionaries.map((dict) => (
            <View
              key={dict.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                backgroundColor: colors.card,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: colors.border,
                padding: spacing.md,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontWeight: "600" }}>{dict.title}</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: ui(12) }}>
                  {dict.termCount.toLocaleString()} {t("dictionary.entries", "entries")}
                  {dict.revision ? ` · ${dict.revision}` : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => void handleDelete(dict)}>
                <Text style={{ color: colors.destructive }}>{t("common.delete", "Delete")}</Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
