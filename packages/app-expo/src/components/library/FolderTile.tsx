/**
 * FolderTile — a folder, at the size a folder is worth.
 *
 * Folders used to take a full book-cover cell each, which on a tablet meant
 * five pastel rectangles the size of paperbacks standing between the reader
 * and their 441 books. Worse, the tile previewed only the books filed
 * DIRECTLY in the folder, so a folder whose books all live in subfolders drew
 * itself as an empty rectangle while its own label read "211 book(s)".
 *
 * A folder is a way to somewhere else, not a thing to look at. So it is drawn
 * small and identically every time: the same stack-of-books mark, the name,
 * the count, and the folder's own colour as a tint — the one piece of it that
 * is genuinely worth recognising at a glance.
 */
import { CheckIcon, MoreVerticalIcon } from "@/components/ui/Icon";
import { folderColor } from "@/lib/library/folder-colors";
import { type ThemeColors, fontSize, fontWeight, radius, ui, useColors } from "@/styles/theme";
import type { BookGroup } from "@readany/core/types";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import BooksSvg from "../../../assets/illustrations/books.svg";

/** The mark is the same size whatever the tile does; only the tile flexes. */
const MARK_SIZE = 34;

interface FolderTileProps {
  group: BookGroup;
  /** Books anywhere inside, subfolders included. */
  count: number;
  width: number;
  onOpen: (groupId: string) => void;
  onMore?: (group: BookGroup) => void;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (group: BookGroup) => void;
  onLongPress?: (group: BookGroup) => void;
}

export const FolderTile = memo(function FolderTile({
  group,
  count,
  width,
  onOpen,
  onMore,
  selectionMode = false,
  selected = false,
  onSelect,
  onLongPress,
}: FolderTileProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const tone = folderColor(group.color);

  return (
    <View style={[s.wrap, { width }]}>
      <TouchableOpacity
        style={[
          s.tile,
          tone ? { backgroundColor: tone.tint, borderColor: tone.accent } : null,
          selected ? { borderWidth: 2, borderColor: colors.primary } : null,
        ]}
        onPress={() => selectionMode ? onSelect?.(group) : onOpen(group.id)}
        onLongPress={() => selectionMode ? onSelect?.(group) : onLongPress?.(group)}
        delayLongPress={450}
        activeOpacity={0.76}
        accessibilityRole="button"
        accessibilityLabel={t("library.folderOpenA11y", {
          name: group.name,
          count,
          defaultValue: "Open folder {{name}}, {{count}} books",
        })}
      >
        {selectionMode ? (
          <View style={[s.selectionMark, { borderColor: colors.primary, backgroundColor: selected ? colors.primary : colors.background }]}>
            {selected ? <CheckIcon size={13} color={colors.primaryForeground} /> : null}
          </View>
        ) : null}
        <BooksSvg width={MARK_SIZE} height={MARK_SIZE} />
        <Text style={s.name} numberOfLines={2}>
          {group.name}
        </Text>
        <Text style={[s.count, tone ? { color: tone.accent } : null]} numberOfLines={1}>
          {t("library.groupBookCount", { count, defaultValue: "{{count}} book(s)" })}
        </Text>
      </TouchableOpacity>

      {/* A sibling of the tile, never a child: a touchable inside a touchable
          is a coin toss on Android, and this one opens a destructive menu. */}
      {onMore && !selectionMode ? (
        <TouchableOpacity
          style={s.moreTouch}
          onPress={() => onMore(group)}
          activeOpacity={0.6}
          accessibilityRole="button"
          accessibilityLabel={t("library.folderMenuA11y", {
            name: group.name,
            defaultValue: "Options for folder {{name}}",
          })}
        >
          <MoreVerticalIcon size={15} color={tone?.accent ?? colors.mutedForeground} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrap: { position: "relative" },
    tile: {
      alignItems: "center",
      gap: 5,
      paddingTop: 12,
      paddingBottom: 10,
      // Room on the right for the ⋮, so a long name never runs under it.
      paddingHorizontal: 10,
      borderRadius: radius.lg,
      backgroundColor: colors.muted,
      borderWidth: 1,
      borderColor: colors.border,
    },
    name: {
      textAlign: "center",
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
      lineHeight: ui(15),
    },
    count: {
      fontSize: fontSize.xs - 1,
      color: colors.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    moreTouch: {
      position: "absolute",
      top: 0,
      right: 0,
      width: 34,
      height: 34,
      alignItems: "center",
      justifyContent: "center",
    },
    selectionMark: {
      position: "absolute",
      top: 7,
      left: 7,
      width: 21,
      height: 21,
      borderRadius: 11,
      borderWidth: 1.5,
      alignItems: "center",
      justifyContent: "center",
      zIndex: 3,
    },
  });
