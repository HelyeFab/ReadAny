import { getPlatformService } from "@readany/core";
import {
  countAiConfigSecrets,
  createBackupSettings,
  createLibraryBackup,
  describeBackup,
  mergeRestoredAiConfig,
  parseBackup,
  readBackupAiConfig,
  restoreLibraryBackup,
  serializeBackup,
} from "@readany/core/backup";
import type { BackupSummary, LibraryBackup } from "@readany/core/backup";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { FolderInputIcon, ShareIcon } from "../../components/ui/Icon";
import { useResponsiveLayout } from "../../hooks/use-responsive-layout";
import { useSettingsStore } from "../../stores/settings-store";
import { fontSize, fontWeight, radius, spacing, useColors } from "../../styles/theme";
import { SettingsHeader } from "./SettingsHeader";

/** Date-stamped so a folder of backups sorts and reads sensibly. */
function backupFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `readany-library-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.readany`;
}

function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString();
}

export default function BackupSettingsScreen() {
  const colors = useColors();
  const layout = useResponsiveLayout();
  const { t } = useTranslation();
  const [busy, setBusy] = useState<"backup" | "restore" | null>(null);

  const shareBackup = useCallback(
    async (backup: LibraryBackup) => {
      const file = new File(Paths.cache, backupFileName());
      if (file.exists) file.delete();
      file.create();
      file.write(serializeBackup(backup));

      const summary = describeBackup(backup);
      const lines = [
        t("settings.restoreRecordCount", "{{count}} 条记录", { count: summary.totalRecords }),
      ];

      // Say whether the AI settings — and the keys — actually made it in. This
      // is the only moment the choice made in the previous dialog can be seen
      // to have taken effect.
      if (summary.settings) {
        lines.push(
          summary.settings.includesSecrets
            ? t("settings.backupIncludesKeys", "已包含你的 AI 设置和 {{count}} 个 API 密钥。", {
                count: summary.settings.endpointsWithKeys,
              })
            : t("settings.backupExcludesKeys", "已包含你的 AI 设置，不含 API 密钥。"),
        );
      }

      const shareable = await Sharing.isAvailableAsync();
      if (shareable) {
        await Sharing.shareAsync(file.uri, {
          mimeType: "application/json",
          dialogTitle: t("settings.backupShareTitle", "保存备份文件"),
        });
      } else {
        // No share sheet (some e-ink and kiosk builds): the file is still
        // written, so tell the user where it is rather than failing silently.
        lines.push(t("settings.backupSavedAt", "已保存到：{{path}}", { path: file.uri }));
      }

      // Shown either way. The share sheet closing is not by itself a signal
      // that anything was written — Android reports no result from it — so
      // without this a backup that worked looked exactly like one that did
      // nothing at all.
      Alert.alert(t("settings.backupDone", "备份已创建"), lines.join("\n"));
    },
    [t],
  );

  const writeBackup = useCallback(
    async (includeSecrets: boolean) => {
      setBusy("backup");
      try {
        await shareBackup(
          await createLibraryBackup({
            appVersion: await getPlatformService().getAppVersion(),
            settings: createBackupSettings(useSettingsStore.getState().aiConfig, {
              includeSecrets,
            }),
          }),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        Alert.alert(
          t("common.error", "错误"),
          t("settings.backupFailed", "备份失败：{{error}}", { error: msg }),
        );
      } finally {
        setBusy(null);
      }
    },
    [shareBackup, t],
  );

  /**
   * The keys are the whole question. A backup file gets shared, dropped in a
   * cloud folder, mailed to yourself — and a key inside it travels in clear
   * text wherever the file goes. So it is asked every time, rather than
   * remembered as a preference someone set once and forgot.
   */
  const handleBackup = useCallback(() => {
    if (busy) return;

    const secretCount = countAiConfigSecrets(useSettingsStore.getState().aiConfig);
    if (secretCount === 0) {
      void writeBackup(false);
      return;
    }

    Alert.alert(
      t("settings.backupKeysTitle", "包含 API 密钥？"),
      t(
        "settings.backupKeysBody",
        "备份会带上你的 AI 设置。文件中的 {{count}} 个 API 密钥将以明文保存——只有在你能安全保管该文件时才包含它们。",
        { count: secretCount },
      ),
      [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("settings.backupKeysExclude", "不包含密钥"),
          onPress: () => void writeBackup(false),
        },
        {
          text: t("settings.backupKeysInclude", "包含密钥"),
          onPress: () => void writeBackup(true),
        },
      ],
    );
  }, [busy, t, writeBackup]);

  const confirmRestore = useCallback(
    (summary: BackupSummary, apply: () => Promise<void>) => {
      const lines = [
        t("settings.restoreFrom", "来自 {{device}}，{{when}}", {
          device: summary.deviceId.slice(0, 8),
          when: formatWhen(summary.createdAt),
        }),
        t("settings.restoreRecordCount", "{{count}} 条记录", { count: summary.totalRecords }),
        "",
        t(
          "settings.restoreMergeExplainer",
          "备份中的条目会合并进当前书库：同一条目以备份为准，本机独有的条目会保留。书籍文件不在备份中，将在下次同步时下载。",
        ),
      ];

      if (summary.settings) {
        lines.push(
          "",
          summary.settings.includesSecrets
            ? t(
                "settings.restoreSettingsWithKeys",
                "同时包含你的 AI 设置（{{count}} 个接入点，含 API 密钥）。",
                { count: summary.settings.endpointCount },
              )
            : t(
                "settings.restoreSettingsNoKeys",
                "同时包含你的 AI 设置（{{count}} 个接入点，不含 API 密钥——本机已有的密钥会保留）。",
                { count: summary.settings.endpointCount },
              ),
        );
      }

      if (summary.unreadableTables.length > 0) {
        lines.push(
          "",
          t("settings.restoreUnreadable", "⚠️ 此备份包含本版本无法恢复的数据：{{tables}}", {
            tables: summary.unreadableTables.join(", "),
          }),
        );
      }

      Alert.alert(t("settings.restoreConfirmTitle", "恢复此备份？"), lines.join("\n"), [
        { text: t("common.cancel", "取消"), style: "cancel" },
        { text: t("common.confirm", "确定"), onPress: () => void apply() },
      ]);
    },
    [t],
  );

  const handleRestore = useCallback(async () => {
    if (busy) return;
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["application/json", "*/*"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      const raw = await new File(picked.assets[0].uri).text();
      const backup = parseBackup(raw);
      if (!backup) {
        Alert.alert(
          t("common.error", "错误"),
          t("settings.restoreNotABackup", "这不是 ReadAny 备份文件。"),
        );
        return;
      }

      confirmRestore(describeBackup(backup), async () => {
        setBusy("restore");
        try {
          const { applied, skipped } = await restoreLibraryBackup(backup);

          // Settings are not database records, so the restore above cannot
          // carry them. Applied after it, and only if the file had any: a
          // keyless backup merges against what this device already holds
          // rather than blanking working keys with the blanks it carries.
          // Reported separately from the records above. Failing here must not
          // be announced as "restore failed" when every record did land, and
          // must not be passed over in silence either.
          const restoredAiConfig = readBackupAiConfig(backup.settings);
          let settingsOutcome: string | null = null;
          if (restoredAiConfig) {
            try {
              const store = useSettingsStore.getState();
              await store.importAIConfig(mergeRestoredAiConfig(restoredAiConfig, store.aiConfig));
              settingsOutcome = t("settings.restoreSettingsDone", "AI 设置已恢复。");
            } catch (settingsError) {
              const msg =
                settingsError instanceof Error ? settingsError.message : String(settingsError);
              settingsOutcome = t("settings.restoreSettingsFailed", "AI 设置恢复失败：{{error}}", {
                error: msg,
              });
            }
          } else if (backup.settings) {
            // The file carries a settings section this build could not read.
            settingsOutcome = t("settings.restoreSettingsUnreadable", "备份中的 AI 设置无法读取。");
          }

          Alert.alert(
            t("settings.restoreDone", "恢复完成"),
            [
              t("settings.restoreResult", "已恢复 {{applied}} 条，跳过 {{skipped}} 条。", {
                applied,
                skipped,
              }),
              ...(settingsOutcome ? [settingsOutcome] : []),
            ].join("\n"),
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          Alert.alert(
            t("common.error", "错误"),
            t("settings.restoreFailed", "恢复失败：{{error}}", { error: msg }),
          );
        } finally {
          setBusy(null);
        }
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert(
        t("common.error", "错误"),
        t("settings.restoreFailed", "恢复失败：{{error}}", { error: msg }),
      );
      setBusy(null);
    }
  }, [busy, confirmRestore, t]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <SettingsHeader title={t("settings.backupTitle", "备份与恢复")} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={[styles.inner, { maxWidth: layout.centeredContentWidth }]}>
          <Text style={[styles.intro, { color: colors.mutedForeground }]}>
            {t(
              "settings.backupIntro",
              "备份文件记录你的书库：书籍条目、分组、标注、笔记、书签、标签、对话与阅读进度。书籍文件本身不包含在内——恢复后会从同步服务器下载。",
            )}
          </Text>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <ShareIcon size={18} color={colors.foreground} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {t("settings.backupCreate", "创建备份")}
              </Text>
            </View>
            <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
              {t(
                "settings.backupCreateDesc",
                "生成一个备份文件，可保存到任意位置或发送到其他设备。",
              )}
            </Text>
            <SettingsButton
              label={t("settings.backupCreateAction", "创建备份文件")}
              onPress={handleBackup}
              busy={busy === "backup"}
              colors={colors}
            />
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.cardHeader}>
              <FolderInputIcon size={18} color={colors.foreground} />
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>
                {t("settings.restoreTitle", "从备份恢复")}
              </Text>
            </View>
            <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>
              {t("settings.restoreDesc", "选择一个备份文件，其中的条目会合并进当前书库。")}
            </Text>
            <SettingsButton
              label={t("settings.restoreAction", "选择备份文件")}
              onPress={handleRestore}
              busy={busy === "restore"}
              colors={colors}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function SettingsButton({
  label,
  onPress,
  busy,
  colors,
}: {
  label: string;
  onPress: () => void;
  busy: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[styles.button, { backgroundColor: colors.primary, opacity: busy ? 0.6 : 1 }]}
      onPress={onPress}
      disabled={busy}
      accessibilityRole="button"
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.primaryForeground} />
      ) : (
        <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { paddingVertical: spacing.lg, alignItems: "center" },
  inner: { width: "100%", paddingHorizontal: spacing.lg, gap: spacing.lg },
  intro: { fontSize: fontSize.sm, lineHeight: fontSize.sm * 1.6 },
  card: {
    borderWidth: 1,
    borderRadius: radius.xl,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { fontSize: fontSize.md, fontWeight: fontWeight.semibold },
  cardDesc: { fontSize: fontSize.sm, lineHeight: fontSize.sm * 1.5 },
  button: {
    height: 48,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
