/**
 * One row of the library list.
 *
 * The list exists for shelves the grid cannot serve: covers are pretty, but a
 * few hundred books are faster to scan as text, and a list has room for the
 * author and progress the grid truncates.
 */
import { memo, useEffect, useState } from "react";
import { Image, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { COVER_PLACEHOLDER } from "@/lib/library/cover-placeholder";
import { FolderIcon } from "@/components/ui/Icon";
import { folderColor } from "@/lib/library/folder-colors";
import { radius, spacing, useColors } from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
import type { Book, BookGroup } from "@readany/core/types";

const ROW_COVER_WIDTH = 44;
const ROW_COVER_HEIGHT = 62;

/** Covers are stored relative to the app data directory, as in BookCard. */
function useCoverUri(raw?: string): string | undefined {
  const [uri, setUri] = useState<string | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    if (!raw) {
      setUri(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setUri(raw);
      return;
    }
    void (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absolute = await platform.joinPath(appData, raw);
        if (!cancelled) setUri(absolute);
      } catch {
        if (!cancelled) setUri(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [raw]);
  return uri;
}

export const LibraryListRow = memo(function LibraryListRow({
  book,
  group,
  bookCount,
  selected,
  onPress,
  onLongPress,
}: {
  book?: Book;
  group?: BookGroup;
  bookCount?: number;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const { t } = useTranslation();
  const coverUri = useCoverUri(book?.meta?.coverUrl);
  const tone = folderColor(group?.color);

  const title = group?.name ?? book?.meta?.title ?? "";
  const subtitle = group
    ? t("library.groupBookCount", { count: bookCount ?? 0, defaultValue: `${bookCount ?? 0}` })
    : book?.meta?.author || "";

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={450}
      activeOpacity={0.7}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.md,
        paddingVertical: spacing.sm,
        paddingHorizontal: spacing.sm,
        borderRadius: radius.md,
        backgroundColor: selected ? colors.muted : "transparent",
      }}
    >
      <View
        style={{
          width: ROW_COVER_WIDTH,
          height: ROW_COVER_HEIGHT,
          borderRadius: radius.sm,
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: tone?.tint ?? colors.muted,
          borderWidth: tone ? 1 : 0,
          borderColor: tone?.accent ?? "transparent",
        }}
      >
        {group ? (
          <FolderIcon size={20} color={tone?.accent ?? colors.mutedForeground} />
        ) : coverUri ? (
          <Image source={{ uri: coverUri }} style={{ width: "100%", height: "100%" }} />
        ) : (
          <Image
            source={COVER_PLACEHOLDER}
            style={{ width: "78%", height: "78%", opacity: 0.6 }}
            resizeMode="contain"
            tintColor={colors.mutedForeground}
          />
        )}
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 15, color: colors.foreground }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} style={{ fontSize: 12, color: colors.mutedForeground }}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {book && book.progress > 0 ? (
        <Text style={{ fontSize: 12, color: colors.mutedForeground }}>
          {Math.round(book.progress * 100)}%
        </Text>
      ) : null}
    </TouchableOpacity>
  );
});
