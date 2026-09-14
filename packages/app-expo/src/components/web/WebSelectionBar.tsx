/**
 * WebSelectionBar — the action bar for text selected on a web page.
 *
 * Deliberately not the book reader's SelectionPopover. That one leads with five
 * highlight colours and a note editor, and none of that can persist against a
 * web page: there is no CFI to anchor it to and no book row to hang it off. A
 * bar that offered them anyway would be lying. So this carries only the actions
 * that work anywhere: look it up, hear it, ask Sensei, copy it.
 *
 * It sits at the bottom of the screen rather than floating over the selection,
 * which keeps it clear of the page's own selection handles and needs no
 * coordinate maths through the page's scroll and zoom.
 */
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { BookOpenIcon, CopyIcon, SparklesIcon, Volume2Icon, XIcon } from "@/components/ui/Icon";
import { fontSize as fs, radius, spacing, ui, useColors, withOpacity } from "@/styles/theme";
import type { ThemeColors } from "@/styles/theme";

interface Props {
  text: string;
  bottomOffset: number;
  isSpeaking?: boolean;
  onDefine: () => void;
  onSpeak: () => void;
  onAsk: () => void;
  onCopy: () => void;
  onDismiss: () => void;
}

export function WebSelectionBar({
  text,
  bottomOffset,
  isSpeaking,
  onDefine,
  onSpeak,
  onAsk,
  onCopy,
  onDismiss,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = makeStyles(colors);

  return (
    <View style={[s.wrapper, { bottom: bottomOffset + spacing.sm }]} pointerEvents="box-none">
      <View style={s.bar}>
        <Text style={s.quote} numberOfLines={1}>
          {text}
        </Text>
        <View style={s.actions}>
          <Action label={t("web.define", "Define")} onPress={onDefine} colors={colors}>
            <BookOpenIcon color={colors.foreground} size={20} />
          </Action>
          <Action
            label={t("web.speak", "Speak")}
            onPress={onSpeak}
            colors={colors}
            active={isSpeaking}
          >
            <Volume2Icon color={isSpeaking ? colors.primary : colors.foreground} size={20} />
          </Action>
          <Action label={t("web.ask", "Ask")} onPress={onAsk} colors={colors}>
            <SparklesIcon color={colors.foreground} size={20} />
          </Action>
          <Action label={t("web.copy", "Copy")} onPress={onCopy} colors={colors}>
            <CopyIcon color={colors.foreground} size={20} />
          </Action>
          <Action label={t("common.close", "Close")} onPress={onDismiss} colors={colors}>
            <XIcon color={colors.mutedForeground} size={20} />
          </Action>
        </View>
      </View>
    </View>
  );
}

function Action({
  label,
  onPress,
  colors,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  colors: ThemeColors;
  active?: boolean;
  children: React.ReactNode;
}) {
  const s = makeStyles(colors);
  return (
    <TouchableOpacity
      style={[s.action, active && { backgroundColor: withOpacity(colors.primary, 0.12) }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      activeOpacity={0.7}
    >
      {children}
      <Text style={[s.actionLabel, active && { color: colors.primary }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    wrapper: {
      position: "absolute",
      left: spacing.md,
      right: spacing.md,
    },
    bar: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
      paddingTop: spacing.sm,
      paddingBottom: spacing.xs,
      shadowColor: "#000",
      shadowOpacity: 0.18,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    quote: {
      color: colors.mutedForeground,
      fontSize: fs.xs,
      marginBottom: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    actions: {
      flexDirection: "row",
      justifyContent: "space-between",
    },
    action: {
      flex: 1,
      alignItems: "center",
      gap: 2,
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
    },
    actionLabel: {
      color: colors.mutedForeground,
      fontSize: ui(10),
    },
  });
