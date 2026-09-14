import { CheckIcon, FolderIcon, LibraryIcon } from "@/components/ui/Icon";
import { fontSize, fontWeight, radius, spacing, ui, useColors } from "@/styles/theme";
/**
 * Choosing what the shelf shows.
 *
 * Folders are listed with their nesting visible, because "BookLibrary" and the
 * eleven folders inside it are a different choice from "BookLibrary" alone —
 * and picking a parent takes its children with it, so the indentation is the
 * explanation of what you are about to get.
 */
import type { BookGroup } from "@readany/core/types";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface ShelfScopeSheetProps {
  visible: boolean;
  groups: BookGroup[];
  mode: "all" | "folders";
  selectedIds: string[];
  bookCountFor: (groupId: string) => number;
  totalBooks: number;
  onShowEverything: () => void;
  onToggleFolder: (groupId: string) => void;
  onClose: () => void;
}

interface Row {
  group: BookGroup;
  depth: number;
}

/** Flatten the folder tree, parents before children, so indentation reads. */
function flatten(groups: BookGroup[]): Row[] {
  const byParent = new Map<string, BookGroup[]>();
  for (const group of groups) {
    const key = group.parentId ?? "";
    byParent.set(key, [...(byParent.get(key) ?? []), group]);
  }
  const rows: Row[] = [];
  const seen = new Set<string>();
  const walk = (parent: string, depth: number) => {
    for (const group of (byParent.get(parent) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      if (seen.has(group.id)) continue;
      seen.add(group.id);
      rows.push({ group, depth });
      walk(group.id, depth + 1);
    }
  };
  walk("", 0);
  return rows;
}

export function ShelfScopeSheet({
  visible,
  groups,
  mode,
  selectedIds,
  bookCountFor,
  totalBooks,
  onShowEverything,
  onToggleFolder,
  onClose,
}: ShelfScopeSheetProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const rows = useMemo(() => flatten(groups), [groups]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: colors.foreground }]}>
            {t("library.shelfScopeTitle", "显示哪些书")}
          </Text>

          <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: colors.border }]}
              onPress={onShowEverything}
            >
              <LibraryIcon size={18} color={colors.foreground} />
              <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={1}>
                {t("library.shelfEverything", "全部书籍")}
              </Text>
              <Text style={[styles.rowCount, { color: colors.mutedForeground }]}>{totalBooks}</Text>
              {mode === "all" ? <CheckIcon size={18} color={colors.primary} /> : null}
            </TouchableOpacity>

            {rows.map(({ group, depth }) => {
              const isSelected = mode === "folders" && selected.has(group.id);
              return (
                <TouchableOpacity
                  key={group.id}
                  style={[styles.row, { borderBottomColor: colors.border }]}
                  onPress={() => onToggleFolder(group.id)}
                >
                  <View style={{ width: depth * spacing.md }} />
                  <FolderIcon size={18} color={colors.mutedForeground} />
                  <Text style={[styles.rowLabel, { color: colors.foreground }]} numberOfLines={1}>
                    {group.name}
                  </Text>
                  <Text style={[styles.rowCount, { color: colors.mutedForeground }]}>
                    {bookCountFor(group.id)}
                  </Text>
                  {isSelected ? <CheckIcon size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <TouchableOpacity style={styles.done} onPress={onClose}>
            <Text style={[styles.doneLabel, { color: colors.primary }]}>
              {t("common.done", "完成")}
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  sheet: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "78%",
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing.lg,
  },
  title: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.semibold,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
  },
  list: { flexGrow: 0 },
  listContent: { paddingHorizontal: spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: ui(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { flex: 1, fontSize: fontSize.sm },
  rowCount: { fontSize: fontSize.xs, fontVariant: ["tabular-nums"] },
  done: {
    alignSelf: "flex-end",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  doneLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
