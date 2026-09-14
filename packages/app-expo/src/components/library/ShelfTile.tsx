import { COVER_PLACEHOLDER } from "@/lib/library/cover-placeholder";
import { FOLDER_COLORS } from "@/lib/library/folder-colors";
import { fontWeight, radius, ui, useColors } from "@/styles/theme";
/**
 * One book on the shelf: its cover, and nothing else.
 *
 * The shelf is for recognising books at a glance, the way you do on a real
 * shelf — by the look of the spine, not by reading every title. So there is no
 * caption here; the title belongs to the detail sheet you get on a long press.
 *
 * Except where there is no cover, which in a real library is a quarter of the
 * books. Those keep the placeholder drawing and their title, because a wall of
 * identical blank rectangles is not a shelf you can read. Each is tinted from
 * its own title, so two coverless books never look like the same book.
 */
import { getPlatformService } from "@readany/core";
import type { Book } from "@readany/core/types";
import { memo, useEffect, useState } from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

/** Same hue for the same book every time, so the shelf does not reshuffle itself. */
function toneFor(seed: string) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  return FOLDER_COLORS[Math.abs(hash) % FOLDER_COLORS.length];
}

interface ShelfTileProps {
  book: Book;
  width: number;
  onOpen: (book: Book) => void;
  onLongPress?: (book: Book) => void;
}

export const ShelfTile = memo(function ShelfTile({
  book,
  width,
  onOpen,
  onLongPress,
}: ShelfTileProps) {
  const colors = useColors();
  const [uri, setUri] = useState<string | undefined>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const raw = book.meta.coverUrl;
    setFailed(false);
    if (!raw) {
      setUri(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setUri(raw);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const resolved = await platform.joinPath(appData, raw);
        if (!cancelled) setUri(resolved);
      } catch {
        if (!cancelled) setUri(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.meta.coverUrl]);

  // Ordinary book proportions, so a shelf of mixed sources still lines up.
  const height = Math.round(width * 1.5);
  const tone = toneFor(book.id || book.meta.title || "");
  const showCover = !!uri && !failed;

  return (
    <TouchableOpacity
      activeOpacity={0.76}
      onPress={() => onOpen(book)}
      onLongPress={onLongPress ? () => onLongPress(book) : undefined}
      delayLongPress={400}
      accessibilityLabel={book.meta.title}
      style={[styles.tile, { width, height, borderColor: colors.border }]}
    >
      {showCover ? (
        <Image
          source={{ uri }}
          style={styles.cover}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={[styles.fallback, { backgroundColor: tone.tint }]}>
          <Image
            source={COVER_PLACEHOLDER}
            style={styles.fallbackArt}
            resizeMode="contain"
            tintColor={tone.accent}
          />
          <Text
            style={[styles.fallbackTitle, { color: tone.accent, fontSize: ui(9) }]}
            numberOfLines={3}
          >
            {book.meta.title}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  tile: {
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  cover: { width: "100%", height: "100%" },
  fallback: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  fallbackArt: { width: "52%", height: "38%", opacity: 0.55, marginBottom: 4 },
  fallbackTitle: {
    textAlign: "center",
    fontWeight: fontWeight.medium,
    lineHeight: ui(11),
  },
});
