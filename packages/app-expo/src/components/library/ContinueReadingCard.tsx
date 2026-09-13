import { BookOpenIcon, PlayIcon } from "@/components/ui/Icon";
/**
 * ContinueReadingCard — the one book the shelf already knows you want.
 *
 * A library is a room you walk into to pick something; on most days there is
 * nothing to pick, because you are in the middle of a book and simply want the
 * page you left. This sits above the shelf and hands that page straight back,
 * so the common case costs one tap instead of a hunt through the covers.
 */
import { COVER_PLACEHOLDER } from "@/lib/library/cover-placeholder";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  withOpacity,
} from "@/styles/theme";
import { getPlatformService } from "@readany/core/services";
import type { Book } from "@readany/core/types";
import { getBookProgressPercent } from "@readany/core/utils";
import { memo, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const COVER_WIDTH = 46;
const COVER_HEIGHT = Math.round(COVER_WIDTH * (41 / 28));

interface ContinueReadingCardProps {
  book: Book;
  onOpen: (book: Book) => void;
}

export const ContinueReadingCard = memo(function ContinueReadingCard({
  book,
  onOpen,
}: ContinueReadingCardProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);
  const [resolvedCoverUrl, setResolvedCoverUrl] = useState<string | undefined>(undefined);

  // Covers are stored relative to the app data dir; resolve the same way the
  // shelf cards do, and fall back to the drawing when there is no art at all.
  useEffect(() => {
    const raw = book.meta.coverUrl;
    if (!raw) {
      setResolvedCoverUrl(undefined);
      return;
    }
    if (raw.startsWith("http") || raw.startsWith("blob") || raw.startsWith("file")) {
      setResolvedCoverUrl(raw);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const absPath = await platform.joinPath(appData, raw);
        if (!cancelled) setResolvedCoverUrl(absPath);
      } catch (err) {
        console.warn("[Library] Failed to resolve cover URL:", err);
        if (!cancelled) setResolvedCoverUrl(undefined);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [book.meta.coverUrl]);

  const progressPct = getBookProgressPercent(book.progress);
  const started = progressPct > 0;

  return (
    <TouchableOpacity
      style={s.card}
      onPress={() => onOpen(book)}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={t("library.continueReadingA11y", {
        title: book.meta.title,
        percent: progressPct,
        defaultValue: "Continue reading {{title}}, {{percent}} percent through",
      })}
    >
      <View style={s.coverWrap}>
        {resolvedCoverUrl ? (
          <Image source={{ uri: resolvedCoverUrl }} style={s.coverImage} resizeMode="cover" />
        ) : (
          <View style={s.coverFallback}>
            <Image
              source={COVER_PLACEHOLDER}
              style={s.coverFallbackArt}
              resizeMode="contain"
              tintColor={colors.stone400}
            />
          </View>
        )}
      </View>

      <View style={s.body}>
        <View style={s.eyebrowRow}>
          <BookOpenIcon size={11} color={colors.mutedForeground} />
          <Text style={s.eyebrow} numberOfLines={1}>
            {started
              ? t("library.continueReading", "Continue reading")
              : t("library.startReading", "Pick up where you left off")}
          </Text>
        </View>
        <Text style={s.title} numberOfLines={1}>
          {book.meta.title}
        </Text>
        <View style={s.progressRow}>
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.max(progressPct, 1)}%` }]} />
          </View>
          <Text style={s.progressText}>{progressPct}%</Text>
        </View>
      </View>

      <View style={s.playButton}>
        <PlayIcon size={15} color={colors.primaryForeground} />
      </View>
    </TouchableOpacity>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      padding: 10,
      marginBottom: 12,
      borderRadius: radius.xl,
      backgroundColor: colors.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 6,
      elevation: 2,
    },
    coverWrap: {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      borderRadius: radius.sm,
      overflow: "hidden",
      backgroundColor: colors.muted,
    },
    coverImage: { width: "100%", height: "100%" },
    coverFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.stone100,
    },
    coverFallbackArt: { width: "78%", height: "78%", opacity: 0.8 },
    body: { flex: 1, minWidth: 0, gap: 3 },
    eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    eyebrow: {
      flexShrink: 1,
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      letterSpacing: 0.3,
    },
    title: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
    progressTrack: {
      flex: 1,
      height: 3,
      borderRadius: 2,
      overflow: "hidden",
      backgroundColor: withOpacity(colors.mutedForeground, 0.2),
    },
    progressFill: { height: "100%", borderRadius: 2, backgroundColor: colors.primary },
    progressText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
    playButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
  });
