/**
 * ImportDestinationSheet — where should these books go?
 *
 * Asked between choosing the files and actually importing them. Sorting a
 * shelf afterwards means selecting a dozen books out of everything that is
 * already there, which is exactly the work the folder was meant to save. The
 * moment you know what is arriving is the cheapest moment to file it.
 *
 * A folder import offers the source folder's own name as the default, because
 * that is almost always the answer.
 */
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
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

import { FolderIcon, FolderPlusIcon } from "@/components/ui/Icon";
import { fontSize as fs, fontWeight as fw, radius, spacing, useColors } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";
import type { BookGroup } from "@readany/core/types";

/** What the sheet resolves to: an existing folder, a new one, or none. */
export type ImportDestination =
  | { kind: "none" }
  | { kind: "existing"; groupId: string }
  | { kind: "new"; name: string; parentId?: string };

interface Props {
  visible: boolean;
  bookCount: number;
  groups: BookGroup[];
  /** Pre-filled name for a new folder, e.g. the folder the books came from. */
  suggestedName?: string;
  /** Folder currently being browsed; a new folder is created inside it. */
  currentGroupId?: string;
  onConfirm: (destination: ImportDestination) => void;
  onCancel: () => void;
}

export function ImportDestinationSheet({
  visible,
  bookCount,
  groups,
  suggestedName,
  currentGroupId,
  onConfirm,
  onCancel,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const s = useMemo(() => makeStyles(colors, insets.bottom), [colors, insets.bottom]);

  const [name, setName] = useState(suggestedName ?? "");
  const [creating, setCreating] = useState(Boolean(suggestedName));

  // Each import is a fresh question, so the field follows the new suggestion
  // rather than keeping whatever the last import typed into it.
  useEffect(() => {
    if (!visible) return;
    setName(suggestedName ?? "");
    setCreating(Boolean(suggestedName));
  }, [visible, suggestedName]);

  /** Depth-first so a subfolder sits under its parent, indented. */
  const ordered = useMemo(() => {
    const out: { group: BookGroup; depth: number }[] = [];
    const walk = (parentId: string | undefined, depth: number) => {
      if (depth > 8) return;
      for (const group of groups.filter((g) => (g.parentId ?? undefined) === parentId)) {
        out.push({ group, depth });
        walk(group.id, depth + 1);
      }
    };
    walk(undefined, 0);
    return out;
  }, [groups]);

  const trimmed = name.trim();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={s.backdrop} onPress={onCancel} />
      <KeyboardAvoidingView behavior="padding" style={s.sheetWrap}>
        <View style={s.sheet}>
          <Text style={s.title}>
            {t("library.importDestinationTitle", {
              count: bookCount,
              defaultValue: `Where should these ${bookCount} book(s) go?`,
            })}
          </Text>

          {creating ? (
            <View style={s.createRow}>
              <TextInput
                style={s.input}
                value={name}
                onChangeText={setName}
                placeholder={t("library.groupNamePlaceholder", "Folder name")}
                placeholderTextColor={colors.mutedForeground}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() =>
                  trimmed && onConfirm({ kind: "new", name: trimmed, parentId: currentGroupId })
                }
              />
              <TouchableOpacity
                style={[s.primaryBtn, !trimmed && s.primaryBtnDisabled]}
                disabled={!trimmed}
                onPress={() => onConfirm({ kind: "new", name: trimmed, parentId: currentGroupId })}
              >
                <Text style={s.primaryBtnText}>{t("common.create", "Create")}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={s.row} onPress={() => setCreating(true)}>
              <FolderPlusIcon size={18} color={colors.primary} />
              <Text style={[s.rowLabel, { color: colors.primary }]}>
                {t("library.newFolder", "New folder…")}
              </Text>
            </TouchableOpacity>
          )}

          <ScrollView style={s.list} keyboardShouldPersistTaps="handled">
            <TouchableOpacity style={s.row} onPress={() => onConfirm({ kind: "none" })}>
              <Text style={s.rowLabel}>{t("library.noFolder", "Not in a folder")}</Text>
            </TouchableOpacity>
            {ordered.map(({ group, depth }) => (
              <TouchableOpacity
                key={group.id}
                style={[s.row, { paddingLeft: spacing.md + depth * spacing.lg }]}
                onPress={() => onConfirm({ kind: "existing", groupId: group.id })}
              >
                <FolderIcon size={18} color={group.color ?? colors.mutedForeground} />
                <Text style={s.rowLabel} numberOfLines={1}>
                  {group.name}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity style={s.cancel} onPress={onCancel}>
            <Text style={s.cancelText}>{t("common.cancel", "Cancel")}</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const makeStyles = (colors: ThemeColors, bottomInset: number) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0,0,0,0.35)",
    },
    sheetWrap: {
      flex: 1,
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderTopLeftRadius: radius.xxl,
      borderTopRightRadius: radius.xxl,
      paddingTop: spacing.lg,
      paddingBottom: bottomInset + spacing.md,
      paddingHorizontal: spacing.lg,
      maxHeight: "78%",
    },
    title: {
      color: colors.foreground,
      fontSize: fs.base,
      fontWeight: fw.semibold,
      marginBottom: spacing.md,
    },
    createRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.sm,
    },
    input: {
      flex: 1,
      height: 42,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.muted,
      color: colors.foreground,
      fontSize: fs.sm,
    },
    primaryBtn: {
      paddingHorizontal: spacing.lg,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryBtnDisabled: { opacity: 0.4 },
    primaryBtnText: {
      color: colors.primaryForeground,
      fontSize: fs.sm,
      fontWeight: fw.semibold,
    },
    list: {
      marginTop: spacing.xs,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingVertical: spacing.md,
      paddingHorizontal: spacing.md,
      borderRadius: radius.md,
    },
    rowLabel: {
      flex: 1,
      color: colors.foreground,
      fontSize: fs.sm,
    },
    cancel: {
      alignItems: "center",
      paddingVertical: spacing.md,
      marginTop: spacing.xs,
    },
    cancelText: {
      color: colors.mutedForeground,
      fontSize: fs.sm,
    },
  });
