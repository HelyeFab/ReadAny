/**
 * FolderBand — every folder at this level, in about the height one book took.
 *
 * Folders sat in the book grid, one cover-sized cell each. On a tablet that
 * put five paperback-sized rectangles between the reader and a shelf of 441
 * books, and the grid had to scroll a full screen before showing a single
 * one. They are navigation, so they belong above the content rather than
 * inside it, and small.
 *
 * Tiles are sized by how wide a folder needs to be to be readable rather than
 * by a fixed column count, the same way the shelf sizes its covers — so a
 * phone fits three across and a 10" tablet fits seven, without either being
 * told which it is.
 *
 * Every folder is still shown, empty ones included. Hiding empty folders is
 * what made this feature invisible in the first place: you could create one,
 * see nothing change, and conclude it had not worked.
 */
import { FolderTile } from "@/components/library/FolderTile";
import { type ThemeColors, fontSize, useColors } from "@/styles/theme";
import type { BookGroup } from "@readany/core/types";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";

/** How wide a folder tile wants to be before the row wraps. */
const TARGET_TILE = 118;
const GAP = 10;

export interface FolderBandEntry {
  group: BookGroup;
  /** Books anywhere inside, subfolders included. */
  count: number;
}

interface FolderBandProps {
  folders: FolderBandEntry[];
  /** Width available to the band, so tiles can size themselves to it. */
  contentWidth: number;
  onOpen: (groupId: string) => void;
  onMore?: (group: BookGroup) => void;
}

export const FolderBand = memo(function FolderBand({
  folders,
  contentWidth,
  onOpen,
  onMore,
}: FolderBandProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);

  const tileWidth = useMemo(() => {
    const columns = Math.max(2, Math.floor((contentWidth + GAP) / (TARGET_TILE + GAP)));
    return Math.floor((contentWidth - GAP * (columns - 1)) / columns);
  }, [contentWidth]);

  if (folders.length === 0) return null;

  return (
    <View style={s.section}>
      <Text style={s.heading} numberOfLines={1}>
        {t("library.folders", "Folders")}
      </Text>
      <View style={s.row}>
        {folders.map(({ group, count }) => (
          <FolderTile
            key={group.id}
            group={group}
            count={count}
            width={tileWidth}
            onOpen={onOpen}
            onMore={onMore}
          />
        ))}
      </View>
    </View>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    section: { marginBottom: 16 },
    heading: {
      fontSize: fontSize.xs - 1,
      color: colors.mutedForeground,
      letterSpacing: 1.1,
      textTransform: "uppercase",
      marginBottom: 8,
      marginLeft: 2,
    },
    row: { flexDirection: "row", flexWrap: "wrap", gap: GAP },
  });
