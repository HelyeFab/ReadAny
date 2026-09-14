import { FOLDER_COLORS } from "@/lib/library/folder-colors";
import { radius, spacing, ui, useColors } from "@/styles/theme";
import type { BookGroup } from "@readany/core/types";
import { useTranslation } from "react-i18next";
/**
 * Pick a folder's colour. Swatches only — a name beside each is noise when the
 * thing being chosen is the colour itself.
 */
import { Modal, Pressable, Text, TouchableOpacity, View } from "react-native";

interface Props {
  group: BookGroup | null;
  onPick: (color?: string) => void;
  onClose: () => void;
}

export function FolderColorSheet({ group, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  if (!group) return null;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          padding: spacing.lg,
          gap: spacing.md,
        }}
      >
        <Text style={{ fontSize: ui(16), fontWeight: "600", color: colors.foreground }}>
          {group.name}
        </Text>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {FOLDER_COLORS.map((color) => (
            <TouchableOpacity
              key={color.id}
              accessibilityLabel={t(color.labelKey, color.fallback)}
              onPress={() => onPick(color.id)}
              style={{
                width: 52,
                height: 52,
                borderRadius: radius.md,
                backgroundColor: color.tint,
                borderWidth: group.color === color.id ? 3 : 1,
                borderColor: group.color === color.id ? color.accent : colors.border,
              }}
            />
          ))}
        </View>

        <TouchableOpacity onPress={() => onPick(undefined)}>
          <Text style={{ color: colors.mutedForeground }}>
            {t("library.folderColorNone", "No colour")}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}
