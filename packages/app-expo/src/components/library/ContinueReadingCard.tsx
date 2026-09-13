/**
 * ContinueReadingCard — the one book the shelf already knows you want.
 *
 * A library is a room you walk into to pick something; on most days there is
 * nothing to pick, because you are in the middle of a book and simply want the
 * page you left. This sits above the shelf and hands that page straight back,
 * so the common case costs one tap instead of a hunt through the covers.
 *
 * It is drawn as a book rather than as a row in a list: the cover at real
 * proportions, a ribbon marking the place, and the title set in the reading
 * serif. The whole card is the target, so there is no button competing with
 * the cover for the tap — on a card whose only action is "open this", a
 * separate play button is a second thing to aim at for no gain.
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

const COVER_WIDTH = 72;
const COVER_HEIGHT = Math.round(COVER_WIDTH * (41 / 28));

/** How far the ribbon hangs above the cover, and how deep its notch cuts. */
const RIBBON_WIDTH = 14;
const RIBBON_OVERHANG = 5;
const RIBBON_NOTCH = 6;

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

  // A page number is friendlier than a percentage, but only when the book has
  // actually been paginated. Most books carry no page count at all, so this
  // line appears when it can be true and is simply absent when it cannot.
  const totalPages = book.meta.totalPages;
  const pageLine =
    totalPages && totalPages > 0
      ? t("library.continuePage", {
          page: Math.max(1, Math.round((progressPct / 100) * totalPages)),
          total: totalPages,
          defaultValue: "page {{page}} of {{total}}",
        })
      : null;

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
      <View style={s.coverSlot}>
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
        {/* Sits outside the clipped cover so it can overhang the top edge. */}
        <View style={s.ribbon} pointerEvents="none">
          <View style={s.ribbonNotch} />
        </View>
      </View>

      <View style={s.body}>
        <Text style={s.eyebrow} numberOfLines={1}>
          {started
            ? t("library.continueReading", "Continue reading")
            : t("library.startReading", "Pick up where you left off")}
        </Text>
        <Text style={s.title} numberOfLines={2}>
          {book.meta.title}
        </Text>

        <View style={s.rule} />

        <View style={s.progressRow}>
          {pageLine ? <Text style={s.pageText}>{pageLine}</Text> : null}
          <View style={s.progressTrack}>
            <View style={[s.progressFill, { width: `${Math.max(progressPct, 1)}%` }]} />
          </View>
          <Text style={s.progressText}>{progressPct}%</Text>
        </View>
      </View>
    </TouchableOpacity>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      padding: 14,
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
    // Holds the cover and the ribbon; the ribbon overhangs, so this must not clip.
    coverSlot: {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      marginTop: RIBBON_OVERHANG,
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
    ribbon: {
      position: "absolute",
      top: -RIBBON_OVERHANG,
      right: 12,
      width: RIBBON_WIDTH,
      height: Math.round(COVER_HEIGHT * 0.42),
      backgroundColor: colors.primary,
      borderTopLeftRadius: 2,
      borderTopRightRadius: 2,
    },
    // A triangle in the card's own colour, cutting the ribbon's tail into a V.
    ribbonNotch: {
      position: "absolute",
      bottom: 0,
      left: 0,
      width: 0,
      height: 0,
      borderLeftWidth: RIBBON_WIDTH / 2,
      borderRightWidth: RIBBON_WIDTH / 2,
      borderBottomWidth: RIBBON_NOTCH,
      borderLeftColor: "transparent",
      borderRightColor: "transparent",
      borderBottomColor: colors.card,
    },
    body: { flex: 1, minWidth: 0, gap: 4 },
    eyebrow: {
      fontSize: fontSize.xs - 1,
      color: colors.mutedForeground,
      letterSpacing: 1.1,
      textTransform: "uppercase",
    },
    title: {
      fontFamily: "serif",
      fontSize: fontSize.md,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      lineHeight: 23,
    },
    rule: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginTop: 4,
      marginBottom: 2,
    },
    progressRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    pageText: {
      fontSize: fontSize.xs,
      color: colors.mutedForeground,
      fontVariant: ["tabular-nums"],
    },
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
  });
