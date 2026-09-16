/**
 * RecentReadsStrip — the books behind the one you were last in.
 *
 * The card above this hands back a single book, which is right on the days
 * you are reading one thing. Most weeks are not like that: a novel, a set
 * text, and something in Japanese are all half-finished at once, and the
 * second of those is as much "where I was" as the first. This is that shelf —
 * small covers, most recent first, one tap each.
 *
 * Every cover carries its own ✕. Hiding the dismissal behind a long-press
 * would repeat a mistake already made once in this app, where book groups
 * existed for months and went unused because reaching them meant a long-press
 * and an unlabelled icon. A row the reader cannot correct in one obvious tap
 * is a row that slowly fills with books they are not reading, and then it
 * stops being read at all.
 *
 * Progress is a bar and nothing else. A percentage under every cover is four
 * more things to read in a row meant to be scanned, and the bar answers the
 * only question being asked — near the start, or nearly done.
 */
import { XIcon } from "@/components/ui/Icon";
import { COVER_PLACEHOLDER } from "@/lib/library/cover-placeholder";
import { useResolvedCoverUrl } from "@/lib/library/use-resolved-cover";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  ui,
  useColors,
  withOpacity,
} from "@/styles/theme";
import type { Book } from "@readany/core/types";
import { getBookProgressPercent } from "@readany/core/utils";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";

const COVER_WIDTH = 64;
const COVER_HEIGHT = Math.round(COVER_WIDTH * (41 / 28));

/**
 * The dismiss badge is drawn smaller than it is touched: 18pt of ink inside a
 * 34pt target that overhangs the cover's corner. A badge big enough to hit
 * comfortably would sit on a sixth of the artwork.
 */
const BADGE_INK = 18;
const BADGE_TOUCH = 34;

interface RecentReadsStripProps {
  books: Book[];
  onOpen: (book: Book) => void;
  onDismiss: (book: Book) => void;
}

export const RecentReadsStrip = memo(function RecentReadsStrip({
  books,
  onOpen,
  onDismiss,
}: RecentReadsStripProps) {
  const colors = useColors();
  const { t } = useTranslation();
  const s = useMemo(() => makeStyles(colors), [colors]);

  if (books.length === 0) return null;

  return (
    <View style={s.section}>
      <Text style={s.heading} numberOfLines={1}>
        {t("library.recentlyRead", "Recently read")}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
        // The badges sit outside their covers, so the row must not clip them.
        style={s.scroller}
      >
        {books.map((book) => (
          <RecentReadTile
            key={book.id}
            book={book}
            colors={colors}
            s={s}
            onOpen={onOpen}
            onDismiss={onDismiss}
          />
        ))}
      </ScrollView>
    </View>
  );
});

interface RecentReadTileProps {
  book: Book;
  colors: ThemeColors;
  s: ReturnType<typeof makeStyles>;
  onOpen: (book: Book) => void;
  onDismiss: (book: Book) => void;
}

const RecentReadTile = memo(function RecentReadTile({
  book,
  colors,
  s,
  onOpen,
  onDismiss,
}: RecentReadTileProps) {
  const { t } = useTranslation();
  const coverUrl = useResolvedCoverUrl(book.meta.coverUrl);
  const progressPct = getBookProgressPercent(book.progress);

  return (
    <View style={s.tile}>
      <TouchableOpacity
        onPress={() => onOpen(book)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={t("library.recentOpenA11y", {
          title: book.meta.title,
          percent: progressPct,
          defaultValue: "Open {{title}}, {{percent}} percent through",
        })}
      >
        <View style={s.coverWrap}>
          {coverUrl ? (
            <Image source={{ uri: coverUrl }} style={s.coverImage} resizeMode="cover" />
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

        <View style={s.progressTrack}>
          <View style={[s.progressFill, { width: `${Math.max(progressPct, 2)}%` }]} />
        </View>

        <Text style={s.title} numberOfLines={2}>
          {book.meta.title}
        </Text>
      </TouchableOpacity>

      {/* Outside the TouchableOpacity above, so a tap on the badge cannot also
          count as a tap on the cover and open the book it is removing. */}
      <TouchableOpacity
        style={s.badgeTouch}
        onPress={() => onDismiss(book)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={t("library.recentDismissA11y", {
          title: book.meta.title,
          defaultValue: "Remove {{title}} from recently read",
        })}
      >
        <View style={s.badge}>
          <XIcon size={11} color={colors.card} />
        </View>
      </TouchableOpacity>
    </View>
  );
});

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    section: { marginBottom: 14 },
    heading: {
      fontSize: fontSize.xs - 1,
      color: colors.mutedForeground,
      letterSpacing: 1.1,
      textTransform: "uppercase",
      marginBottom: 8,
      marginLeft: 2,
    },
    // Room above for the badge overhang and below for the two-line title.
    scroller: { overflow: "visible" },
    row: { gap: 12, paddingTop: 6, paddingRight: 4, paddingLeft: 2 },
    tile: { width: COVER_WIDTH },
    coverWrap: {
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      borderRadius: radius.sm,
      overflow: "hidden",
      backgroundColor: colors.muted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    coverImage: { width: "100%", height: "100%" },
    coverFallback: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.stone100,
    },
    coverFallbackArt: { width: "78%", height: "78%", opacity: 0.8 },
    progressTrack: {
      height: 3,
      marginTop: 6,
      borderRadius: 2,
      overflow: "hidden",
      backgroundColor: withOpacity(colors.mutedForeground, 0.2),
    },
    progressFill: { height: "100%", borderRadius: 2, backgroundColor: colors.primary },
    title: {
      marginTop: 5,
      fontSize: fontSize.xs - 1,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
      lineHeight: ui(13),
    },
    // A generous target, mostly transparent, hung off the cover's top corner.
    badgeTouch: {
      position: "absolute",
      top: -(BADGE_TOUCH - BADGE_INK) / 2,
      right: -(BADGE_TOUCH - BADGE_INK) / 2,
      width: BADGE_TOUCH,
      height: BADGE_TOUCH,
      alignItems: "center",
      justifyContent: "center",
    },
    badge: {
      width: BADGE_INK,
      height: BADGE_INK,
      borderRadius: BADGE_INK / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.foreground,
      borderWidth: 1.5,
      borderColor: colors.card,
    },
  });
