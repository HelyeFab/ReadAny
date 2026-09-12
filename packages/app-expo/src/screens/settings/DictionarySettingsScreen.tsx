/**
 * Dictionaries — import the same Yomitan packs used in the browser.
 */
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as DocumentPicker from "expo-document-picker";
import { SettingsHeader } from "./SettingsHeader";
import { radius, spacing, useColors } from "@/styles/theme";
import type { DictionaryInfo } from "@/lib/dictionary/yomitan-import";

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
    const picked = await DocumentPicker.getDocumentAsync({
      type: ["application/zip", "application/octet-stream"],
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets?.[0]) return;

    setBusy(true);
    setProgress(null);
    try {
      const { importYomitanZip } = await import("@/lib/dictionary/yomitan-import");
      const info = await importYomitanZip(picked.assets[0].uri, (done, total, title) => {
        setProgress(`${title} — ${done}/${total}`);
      });
      await refresh();
      Alert.alert(
        info.title,
        t("dictionary.imported", "{{count}} entries imported.", { count: info.termCount }),
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
        <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
          {t(
            "dictionary.description",
            "Import a Yomitan dictionary archive. The same packs your browser extension uses will work here.",
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
                <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
                  {dict.termCount.toLocaleString()}{" "}
                  {t("dictionary.entries", "entries")}
                  {dict.revision ? ` · ${dict.revision}` : ""}
                </Text>
              </View>
              <TouchableOpacity onPress={() => void handleDelete(dict)}>
                <Text style={{ color: colors.destructive }}>
                  {t("common.delete", "Delete")}
                </Text>
              </TouchableOpacity>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
