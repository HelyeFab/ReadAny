/**
 * HighlightExportSheet — what to export, in what shape, and where it lands.
 *
 * Highlights are the part of a book worth keeping, and keeping them means
 * knowing where they went. Moon+ Reader put them in Drive and that was the
 * whole appeal: a folder you could open six months later. So this asks the
 * three questions that decide findability — scope, format, filing — shows the
 * exact path the file will take, and then remembers the answers so the next
 * export is one tap.
 *
 * Two destinations: the phone's own share sheet (unchanged, always there) and
 * the WebDAV server the library already syncs with.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CheckIcon, CloudIcon, FolderIcon, ShareIcon } from "@/components/ui/Icon";
import {
  fontSize as fs,
  type ThemeColors,
  fontWeight as fw,
  radius,
  spacing,
  useColors,
} from "@/styles/theme";
import type { ExportFormat } from "@readany/core/export";
import type {
  ExportScope,
  HighlightExportPrefs,
} from "@readany/core/export/highlight-export-prefs";
import { type FolderScheme, buildFiledPath } from "@readany/core/export/highlight-filing";

export type ExportDestination = "share" | "webdav";

interface Props {
  visible: boolean;
  /** Title of the book the sheet was opened from. */
  bookTitle: string;
  bookAuthor?: string;
  /** How many books have highlights, for the "all books" option. */
  bookCount: number;
  prefs: HighlightExportPrefs;
  /** False when no WebDAV account is set up, which disables that destination. */
  webDavConfigured: boolean;
  /** Host of the configured WebDAV server, shown so it is obvious where this goes. */
  webDavLabel?: string;
  busy?: boolean;
  onChange: (prefs: HighlightExportPrefs) => void;
  onExport: (destination: ExportDestination) => void;
  onCancel: () => void;
}

const FORMATS: { value: ExportFormat; labelKey: string; fallback: string }[] = [
  { value: "markdown", labelKey: "notes.formatMarkdown", fallback: "Markdown" },
  { value: "obsidian", labelKey: "notes.formatObsidian", fallback: "Obsidian" },
  { value: "json", labelKey: "notes.formatJson", fallback: "JSON" },
  { value: "notion", labelKey: "notes.formatNotion", fallback: "Notion (clipboard)" },
];

const SCHEMES: { value: FolderScheme; labelKey: string; fallback: string }[] = [
  { value: "flat", labelKey: "notes.schemeFlat", fallback: "No subfolders" },
  { value: "book", labelKey: "notes.schemeBook", fallback: "By book" },
  { value: "author", labelKey: "notes.schemeAuthor", fallback: "By author" },
  { value: "yearMonth", labelKey: "notes.schemeYearMonth", fallback: "By year / month" },
  {
    value: "yearMonthBook",
    labelKey: "notes.schemeYearMonthBook",
    fallback: "By year / month / book",
  },
  { value: "date", labelKey: "notes.schemeDate", fallback: "By date" },
];

export function HighlightExportSheet({
  visible,
  bookTitle,
  bookAuthor,
  bookCount,
  prefs,
  webDavConfigured,
  webDavLabel,
  busy,
  onChange,
  onExport,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  // The folder is typed, so it gets a local draft and is committed on blur —
  // rewriting the path preview on every keystroke of a half-typed folder
  // makes the preview flicker through nonsense.
  const [folderDraft, setFolderDraft] = useState(prefs.baseFolder);
  const [nameDraft, setNameDraft] = useState(prefs.filenameTemplate);

  useEffect(() => {
    if (!visible) return;
    setFolderDraft(prefs.baseFolder);
    setNameDraft(prefs.filenameTemplate);
  }, [visible, prefs.baseFolder, prefs.filenameTemplate]);

  const isAll = prefs.scope === "all";
  const clipboardOnly = prefs.format === "notion";

  const preview = useMemo(() => {
    const filed = buildFiledPath(
      {
        baseFolder: prefs.baseFolder,
        scheme: prefs.scheme,
        filenameTemplate: prefs.filenameTemplate,
        format: prefs.format,
      },
      {
        title: isAll
          ? t("notes.allBooksFileName", { count: bookCount, defaultValue: "All books" })
          : bookTitle,
        author: isAll ? t("notes.variousAuthors", "Various") : bookAuthor,
        now: new Date(),
      },
    );
    return filed.path;
  }, [prefs, isAll, bookTitle, bookAuthor, bookCount, t]);

  const set = (patch: Partial<HighlightExportPrefs>) => onChange({ ...prefs, ...patch });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={busy ? undefined : onCancel} />
      <KeyboardAvoidingView behavior="padding" style={s.sheetWrap}>
        <View style={s.sheet}>
          <Text style={s.title}>{t("notes.exportTitle", "Export highlights")}</Text>

          <ScrollView style={s.body} keyboardShouldPersistTaps="handled">
            {/* Scope */}
            <Text style={s.sectionLabel}>{t("notes.exportScope", "What")}</Text>
            <View style={s.chipRow}>
              <Chip
                s={s}
                label={t("notes.scopeThisBook", "This book")}
                selected={!isAll}
                onPress={() => set({ scope: "book" as ExportScope })}
              />
              <Chip
                s={s}
                label={t("notes.scopeAllBooks", {
                  count: bookCount,
                  defaultValue: `All ${bookCount} books`,
                })}
                selected={isAll}
                onPress={() => set({ scope: "all" as ExportScope })}
              />
            </View>

            {/* Format */}
            <Text style={s.sectionLabel}>{t("notes.exportFormat", "Format")}</Text>
            <View style={s.chipRow}>
              {FORMATS.map((f) => (
                <Chip
                  key={f.value}
                  s={s}
                  label={t(f.labelKey, f.fallback)}
                  selected={prefs.format === f.value}
                  onPress={() => set({ format: f.value })}
                />
              ))}
            </View>

            {/* Filing — meaningless for the clipboard, so it steps aside */}
            {!clipboardOnly && (
              <>
                <Text style={s.sectionLabel}>{t("notes.exportFolder", "Folder")}</Text>
                <View style={s.inputRow}>
                  <FolderIcon size={16} color={colors.mutedForeground} />
                  <TextInput
                    style={s.input}
                    value={folderDraft}
                    onChangeText={setFolderDraft}
                    onBlur={() => set({ baseFolder: folderDraft })}
                    onSubmitEditing={() => set({ baseFolder: folderDraft })}
                    placeholder="/Highlights"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                </View>

                <Text style={s.sectionLabel}>{t("notes.exportFiling", "Sort into")}</Text>
                <View style={s.chipRow}>
                  {SCHEMES.map((scheme) => (
                    <Chip
                      key={scheme.value}
                      s={s}
                      label={t(scheme.labelKey, scheme.fallback)}
                      selected={prefs.scheme === scheme.value}
                      onPress={() => set({ scheme: scheme.value })}
                    />
                  ))}
                </View>

                <Text style={s.sectionLabel}>{t("notes.exportFilename", "File name")}</Text>
                <View style={s.inputRow}>
                  <TextInput
                    style={s.input}
                    value={nameDraft}
                    onChangeText={setNameDraft}
                    onBlur={() => set({ filenameTemplate: nameDraft })}
                    onSubmitEditing={() => set({ filenameTemplate: nameDraft })}
                    placeholder="{title} — {date}"
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                  />
                </View>
                <Text style={s.hint}>
                  {t(
                    "notes.exportTokens",
                    "Tokens: {title} {author} {date} {time} {year} {month} {day}",
                  )}
                </Text>

                <Text style={s.sectionLabel}>
                  {t("notes.exportExisting", "If the name is taken")}
                </Text>
                <View style={s.chipRow}>
                  <Chip
                    s={s}
                    label={t("notes.conflictKeepBoth", "Keep both")}
                    selected={prefs.conflict === "keepBoth"}
                    onPress={() => set({ conflict: "keepBoth" })}
                  />
                  <Chip
                    s={s}
                    label={t("notes.conflictOverwrite", "Replace")}
                    selected={prefs.conflict === "overwrite"}
                    onPress={() => set({ conflict: "overwrite" })}
                  />
                </View>

                {/* The whole point of the sheet: see where it is going. */}
                <View style={s.preview}>
                  <Text style={s.previewLabel}>{t("notes.exportPreview", "Saves as")}</Text>
                  <Text style={s.previewPath} numberOfLines={2}>
                    {preview}
                  </Text>
                </View>
              </>
            )}
          </ScrollView>

          <View style={s.actions}>
            <TouchableOpacity
              style={[s.secondaryBtn, busy && s.btnDisabled]}
              onPress={() => onExport("share")}
              disabled={busy}
            >
              <ShareIcon size={16} color={colors.foreground} />
              <Text style={s.secondaryBtnText}>
                {clipboardOnly ? t("notes.copyToClipboard", "Copy") : t("notes.share", "Share…")}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.primaryBtn, (busy || !webDavConfigured || clipboardOnly) && s.btnDisabled]}
              onPress={() => onExport("webdav")}
              disabled={busy || !webDavConfigured || clipboardOnly}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <CloudIcon size={16} color={colors.primaryForeground} />
              )}
              <Text style={s.primaryBtnText} numberOfLines={1}>
                {webDavLabel
                  ? t("notes.saveToServer", {
                      server: webDavLabel,
                      defaultValue: `Save to ${webDavLabel}`,
                    })
                  : t("notes.saveToWebDav", "Save to server")}
              </Text>
            </TouchableOpacity>
          </View>

          {!webDavConfigured && (
            <Text style={s.hint}>
              {t(
                "notes.webDavNotConfigured",
                "Connect a WebDAV server in Settings → Sync to save highlights there.",
              )}
            </Text>
          )}

          <TouchableOpacity style={s.cancel} onPress={onCancel} disabled={busy}>
            <Text style={s.cancelText}>{t("common.cancel", "Cancel")}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Chip({
  s,
  label,
  selected,
  onPress,
}: {
  s: ReturnType<typeof makeStyles>;
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[s.chip, selected && s.chipSelected]}
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected }}
    >
      {selected && <CheckIcon size={12} color={s.chipSelectedText.color as string} />}
      <Text style={[s.chipText, selected && s.chipSelectedText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.35)" },
    sheetWrap: { flex: 1, justifyContent: "flex-end" },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingTop: spacing.lg,
      paddingBottom: bottomInset + spacing.md,
      paddingHorizontal: spacing.lg,
      maxHeight: "88%",
    },
    title: {
      color: colors.foreground,
      fontSize: fs.base,
      fontWeight: fw.semibold,
      marginBottom: spacing.sm,
    },
    body: { marginBottom: spacing.sm },
    sectionLabel: {
      color: colors.mutedForeground,
      fontSize: fs.xs,
      marginTop: spacing.md,
      marginBottom: spacing.xs,
    },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    chipSelected: { backgroundColor: colors.primary },
    chipText: { color: colors.foreground, fontSize: fs.xs },
    chipSelectedText: { color: colors.primaryForeground },
    inputRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.muted,
    },
    input: { flex: 1, height: 42, color: colors.foreground, fontSize: fs.sm },
    hint: { color: colors.mutedForeground, fontSize: fs.xs, marginTop: spacing.xs },
    preview: {
      marginTop: spacing.md,
      padding: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.muted,
    },
    previewLabel: { color: colors.mutedForeground, fontSize: fs.xs, marginBottom: 2 },
    previewPath: { color: colors.foreground, fontSize: fs.sm },
    actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.xs },
    secondaryBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      height: 46,
      paddingHorizontal: spacing.lg,
      borderRadius: radius.md,
      backgroundColor: colors.muted,
    },
    secondaryBtnText: { color: colors.foreground, fontSize: fs.sm, fontWeight: fw.semibold },
    primaryBtn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: spacing.sm,
      height: 46,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
    },
    primaryBtnText: {
      color: colors.primaryForeground,
      fontSize: fs.sm,
      fontWeight: fw.semibold,
      flexShrink: 1,
    },
    btnDisabled: { opacity: 0.4 },
    cancel: { alignItems: "center", paddingVertical: spacing.md },
    cancelText: { color: colors.mutedForeground, fontSize: fs.sm },
  });
