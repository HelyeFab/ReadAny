import {
  FolderPlusIcon,
  LayersIcon,
  LayoutGridIcon,
  ListIcon,
  SearchIcon,
  SortAscIcon,
} from "@/components/ui/Icon";
import { radius, spacing, ui, useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
/**
 * The library's own menu.
 *
 * The header had grown to six unlabelled icons, which is how folders stayed
 * hidden for months: nothing said what any of them did. One entry point, with
 * words next to the icons, and the state each option is in shown on the right.
 */
import { Modal, Pressable, Text, TouchableOpacity, View } from "react-native";

interface Props {
  visible: boolean;
  isGroupView: boolean;
  isListView: boolean;
  canCreateFolder: boolean;
  onClose: () => void;
  onSearch: () => void;
  onSort: () => void;
  onToggleFolders: () => void;
  onToggleListView: () => void;
  onNewFolder: () => void;
}

export function LibraryMenuSheet({
  visible,
  isGroupView,
  isListView,
  canCreateFolder,
  onClose,
  onSearch,
  onSort,
  onToggleFolders,
  onToggleListView,
  onNewFolder,
}: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  if (!visible) return null;

  const run = (action: () => void) => () => {
    onClose();
    action();
  };

  const items: {
    key: string;
    label: string;
    value?: string;
    Icon: typeof SearchIcon;
    onPress: () => void;
  }[] = [
    {
      key: "search",
      label: t("library.searchBooks", "Search"),
      Icon: SearchIcon,
      onPress: run(onSearch),
    },
    {
      key: "sort",
      label: t("library.sort", "Sort"),
      Icon: SortAscIcon,
      onPress: run(onSort),
    },
    {
      key: "folders",
      label: t("library.folderView", "Folders"),
      value: isGroupView ? t("common.on", "On") : t("common.off", "Off"),
      Icon: LayersIcon,
      onPress: run(onToggleFolders),
    },
    {
      key: "layout",
      label: t("library.layout", "Layout"),
      value: isListView ? t("library.listView", "List view") : t("library.gridView", "Grid view"),
      Icon: isListView ? ListIcon : LayoutGridIcon,
      onPress: run(onToggleListView),
    },
  ];

  if (canCreateFolder) {
    items.push({
      key: "newFolder",
      label: t("library.newFolder", "New folder"),
      Icon: FolderPlusIcon,
      onPress: run(onNewFolder),
    });
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)" }} onPress={onClose} />
      <View
        style={{
          backgroundColor: colors.card,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          paddingVertical: spacing.sm,
        }}
      >
        {items.map((item) => (
          <TouchableOpacity
            key={item.key}
            onPress={item.onPress}
            activeOpacity={0.7}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.md,
              paddingVertical: spacing.md,
              paddingHorizontal: spacing.lg,
            }}
          >
            <item.Icon size={18} color={colors.mutedForeground} />
            <Text style={{ flex: 1, fontSize: ui(15), color: colors.foreground }}>
              {item.label}
            </Text>
            {item.value ? (
              <Text style={{ fontSize: ui(13), color: colors.mutedForeground }}>{item.value}</Text>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>
    </Modal>
  );
}
