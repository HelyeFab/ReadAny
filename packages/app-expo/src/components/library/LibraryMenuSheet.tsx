import {
  CopyIcon,
  FolderPlusIcon,
  LayersIcon,
  LayoutGridIcon,
  LibraryIcon,
  ListIcon,
  SearchIcon,
  SortAscIcon,
  SparklesIcon,
} from "@/components/ui/Icon";
import { radius, spacing, ui, useColors } from "@/styles/theme";
import { useTranslation } from "react-i18next";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
  /** Current layout, so the row can name it and show its icon. */
  viewMode: "grid" | "list" | "shelf";
  canCreateFolder: boolean;
  /** How many PDFs could be given a cover; the row hides when none can. */
  coverlessPdfCount?: number;
  onGenerateCovers?: () => void;
  /** How many books have no content hash yet; the row hides when none do. */
  unidentifiedBookCount?: number;
  onIdentifyBooks?: () => void;
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
  viewMode,
  canCreateFolder,
  coverlessPdfCount = 0,
  onGenerateCovers,
  unidentifiedBookCount = 0,
  onIdentifyBooks,
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

  const insets = useSafeAreaInsets();

  const layoutLabel =
    viewMode === "list"
      ? t("library.listView", "List view")
      : viewMode === "shelf"
        ? t("library.shelfView", "Shelf view")
        : t("library.gridView", "Grid view");
  const layoutIcon =
    viewMode === "list" ? ListIcon : viewMode === "shelf" ? LibraryIcon : LayoutGridIcon;

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
      value: layoutLabel,
      Icon: layoutIcon,
      onPress: run(onToggleListView),
    },
  ];

  if (coverlessPdfCount > 0 && onGenerateCovers) {
    items.push({
      key: "pdfCovers",
      label: t("library.generateCovers", "Generate PDF covers"),
      value: String(coverlessPdfCount),
      Icon: SparklesIcon,
      onPress: run(onGenerateCovers),
    });
  }

  if (unidentifiedBookCount > 0 && onIdentifyBooks) {
    items.push({
      key: "identifyBooks",
      label: t("library.identifyBooks", "Identify books"),
      value: String(unidentifiedBookCount),
      Icon: CopyIcon,
      onPress: run(onIdentifyBooks),
    });
  }

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
          paddingTop: spacing.sm,
          // The app draws edge to edge on Android 15+, so the system
          // navigation bar sits ON the window. Without this the last rows are
          // under it — invisible and untappable, which is how "Layout" went
          // missing on a device with a tall button bar.
          paddingBottom: Math.max(spacing.sm, insets.bottom + spacing.sm),
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
