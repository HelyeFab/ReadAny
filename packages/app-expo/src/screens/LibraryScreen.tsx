import { BookCard } from "@/components/library/BookCard";
import { GroupCard } from "@/components/library/GroupCard";
import { FolderColorSheet } from "@/components/library/FolderColorSheet";
import { GroupPickerSheet } from "@/components/library/GroupPickerSheet";
import { LibraryListRow } from "@/components/library/LibraryListRow";
import { LibraryMenuSheet } from "@/components/library/LibraryMenuSheet";
import { cafeIllustration } from "@/lib/library/cafe-illustration";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  CheckCheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  DatabaseIcon,
  FolderInputIcon,
  FolderPlusIcon,
  LayoutGridIcon,
  ListIcon,
  MoreVerticalIcon,
  FolderMinusIcon,
  HashIcon,
  LayersIcon,
  PlusIcon,
  SearchIcon,
  SortAscIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { SyncButton } from "@/components/ui/SyncButton";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { setCallback, setExtractorRef } from "@/lib/rag/auto-vectorize-service";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { WebDavConnectSheet } from "@/screens/library/WebDavConnectSheet";
import { WebDavImportSourceSheet } from "@/screens/library/WebDavImportSourceSheet";
import { useLibraryStore } from "@/stores/library-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
  type WebDavImportSource,
  getPlatformService,
} from "@readany/core";
import { setFallbackContentProvider } from "@readany/core/ai";
import { onLibraryChanged } from "@readany/core/events/library-events";
import { useSyncStore } from "@readany/core/stores";
import { SYNC_SECRET_KEYS } from "@readany/core/sync/sync-backend";
import type { Book, BookGroup, SortField, SortOrder } from "@readany/core/types";
import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";
/**
 * LibraryScreen — matching Tauri mobile LibraryPage exactly.
 * Features: header search/sort/import, tag filter, vectorization progress banner,
 * tag management sheet, book grid (3 cols), empty/loading states.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";
import { TagManagementSheet } from "./library/TagManagementSheet";
import { useBookDownload } from "./library/useBookDownload";
import { useVectorizationQueue } from "./library/useVectorizationQueue";

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = "";

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  return btoa(binary);
}

const BOOK_PNG = require("../../assets/book.png");
const BOOK_DARK_PNG = require("../../assets/book-dark.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NUM_COLUMNS = 3;
const GRID_GAP = 12;

function splitUrlPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function deriveImportBaseUrl(url: string, remoteRoot?: string): string {
  if (!remoteRoot?.trim()) return url;

  try {
    const parsed = new URL(url);
    const baseSegments = splitUrlPathSegments(parsed.pathname.replace(/\/+$/, ""));
    const rootSegments = splitUrlPathSegments(remoteRoot.trim());

    if (
      rootSegments.length > 0 &&
      baseSegments.length >= rootSegments.length &&
      rootSegments.every(
        (segment, index) =>
          baseSegments[baseSegments.length - rootSegments.length + index] === segment,
      )
    ) {
      const nextSegments = baseSegments.slice(0, baseSegments.length - rootSegments.length);
      parsed.pathname = nextSegments.length > 0 ? `/${nextSegments.join("/")}` : "/";
      return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
    }
  } catch {
    return url;
  }

  return url;
}

const SORT_OPTIONS: { field: SortField; labelKey: string }[] = [
  { field: "lastOpenedAt", labelKey: "library.sortRecent" },
  { field: "addedAt", labelKey: "library.sortAdded" },
  { field: "title", labelKey: "library.sortTitle" },
  { field: "author", labelKey: "library.sortAuthor" },
  { field: "progress", labelKey: "library.sortProgress" },
];

type LibraryGridItem =
  | { type: "group"; group: BookGroup; books: Book[]; totalCount?: number }
  | { type: "book"; book: Book };

export function LibraryScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const layout = useResponsiveLayout();
  const gridGap = layout.isTablet ? 16 : GRID_GAP;
  const columnCount = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : NUM_COLUMNS;
  const contentWidth = layout.centeredContentWidth;
  const gridItemWidth = Math.floor((contentWidth - gridGap * (columnCount - 1)) / columnCount);
  const s = useMemo(
    () =>
      makeStyles(colors, {
        horizontalPadding: layout.horizontalPadding,
        contentWidth,
        gridGap,
        gridItemWidth,
        isWideScreen: layout.isTablet,
      }),
    [colors, contentWidth, gridGap, gridItemWidth, layout.horizontalPadding, layout.isTablet],
  );
  const [showSearch, setShowSearch] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [tagSheetBook, setTagSheetBook] = useState<Book | null>(null);
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [sourceSheetAnchor, setSourceSheetAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [temporaryWebDavOpen, setTemporaryWebDavOpen] = useState(false);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [pendingLocalImport, setPendingLocalImport] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [showGroupPicker, setShowGroupPicker] = useState(false);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const [colorPickerGroup, setColorPickerGroup] = useState<BookGroup | null>(null);
  const [batchTagBookIds, setBatchTagBookIds] = useState<string[]>([]);
  const [groupNameModal, setGroupNameModal] = useState<{
    mode: "create" | "rename";
    group?: BookGroup;
  } | null>(null);
  const [groupNameInput, setGroupNameInput] = useState("");
  const importButtonAnchorRef = useRef<View>(null);
  const emptyImportAnchorRef = useRef<View>(null);
  const localImportInFlightRef = useRef(false);

  const extractorRef = useRef<ExtractorRef>(null);
  const loadSyncConfig = useSyncStore((state) => state.loadConfig);
  const syncConfig = useSyncStore((state) => state.config);
  const syncBackendType = useSyncStore((state) => state.backendType);

  const {
    books,
    groups,
    isLoaded,
    isImporting,
    filter,
    allTags,
    activeTag,
    activeGroupId,
    isGroupView,
    loadBooks,
    importBooks,
    removeBook,
    setFilter,
    setGroupView,
    setActiveGroupId,
    setActiveTag,
    addTag,
    addGroup,
    setGroupColor,
    setGroupViewPrefs,
    viewMode,
    setViewMode,
    renameGroup,
    removeGroup,
    moveBooksToGroup,
    addTagToBook,
    removeTagFromBook,
    removeTag,
    renameTag,
  } = useLibraryStore();

  const { downloadingBookId, downloadProgress, downloadBook } = useBookDownload({
    loadBooks,
    // Download finishes silently — user can re-tap the book to open it.
    onSuccess: () => {},
  });

  const { vectorQueue, vectorizingBookId, vectorProgress, handleVectorize } = useVectorizationQueue(
    { extractorRef, nav },
  );

  const openSearch = useCallback(() => {
    setShowSearch(true);
    Animated.timing(searchAnim, { toValue: 1, duration: 300, useNativeDriver: false }).start(() => {
      searchInputRef.current?.focus();
    });
  }, [searchAnim]);

  const closeSearch = useCallback(() => {
    Animated.timing(searchAnim, { toValue: 0, duration: 250, useNativeDriver: false }).start(() => {
      setShowSearch(false);
      setFilter({ search: "" });
    });
  }, [searchAnim, setFilter]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);
  useEffect(() => {
    void loadSyncConfig();
  }, [loadSyncConfig]);

  useEffect(() => {
    setExtractorRef(extractorRef.current);
    setFallbackContentProvider({
      async getChapters(book) {
        if (!extractorRef.current) throw new Error("Mobile fallback extractor is not ready");
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        const filePath =
          book.filePath.startsWith("/") ||
          book.filePath.startsWith("file://") ||
          book.filePath.startsWith("asset://") ||
          book.filePath.startsWith("http")
            ? book.filePath
            : await platform.joinPath(appData, book.filePath);
        if (/^https?:\/\//i.test(filePath)) {
          throw new Error("Mobile original-file search requires a local book file");
        }

        const file = new ExpoFile(filePath);
        if (!file.exists) throw new Error("Book file is not available on this device");

        const bytes = await platform.readFile(filePath);
        const mimeTypes: Record<string, string> = {
          epub: "application/epub+zip",
          pdf: "application/pdf",
          mobi: "application/x-mobipocket-ebook",
          azw: "application/vnd.amazon.ebook",
          azw3: "application/vnd.amazon.ebook",
          cbz: "application/vnd.comicbook+zip",
          cbr: "application/vnd.comicbook+zip",
          fb2: "application/x-fictionbook+xml",
          fbz: "application/x-zip-compressed-fb2",
          txt: "text/plain",
        };
        return extractorRef.current.extractChapters(
          bytesToBase64(bytes),
          mimeTypes[String(book.format || "").toLowerCase()] || "application/epub+zip",
        );
      },
    });
    setCallback((bookId, progress) => {
      console.log(
        `[AutoVectorize] Book ${bookId}: ${progress.status} (${Math.round(progress.progress * 100)}%)`,
      );
    });
    return () => {
      setExtractorRef(null);
      setFallbackContentProvider(null);
      setCallback(null);
    };
  }, []);

  useEffect(() => {
    return onLibraryChanged((deletedTags) => loadBooks(deletedTags));
  }, [loadBooks]);

  const filteredBooks = useMemo(() => {
    let result = [...books];
    if (activeTag === "__uncategorized__") {
      result = result.filter((b) => b.tags.length === 0);
    } else if (activeTag) {
      result = result.filter((b) => b.tags.includes(activeTag));
    }
    if (activeGroupId) {
      result = result.filter((b) => b.groupId === activeGroupId);
    }
    const search = filter.search.toLowerCase().trim();
    if (search) {
      result = result.filter(
        (b) =>
          b.meta.title.toLowerCase().includes(search) ||
          b.meta.author?.toLowerCase().includes(search) ||
          b.tags.some((tag) => tag.toLowerCase().includes(search)),
      );
    }
    const { sortField, sortOrder } = filter;
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.meta.title.localeCompare(b.meta.title);
          break;
        case "author":
          cmp = (a.meta.author || "").localeCompare(b.meta.author || "");
          break;
        case "addedAt":
          cmp = (a.addedAt || 0) - (b.addedAt || 0);
          break;
        case "lastOpenedAt":
          cmp = (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0);
          break;
        case "progress":
          cmp = a.progress - b.progress;
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
    return result;
  }, [books, filter, activeTag, activeGroupId]);

  const activeGroup = useMemo(
    () => groups.find((group) => group.id === activeGroupId) ?? null,
    [groups, activeGroupId],
  );

  const hasSearch = filter.search.trim().length > 0;

  /** "Series › Volume 1" — without it, a nested folder is indistinguishable. */
  const folderPathLabel = useMemo(() => {
    if (!activeGroupId) return t("sidebar.library", "书库");
    const trail: string[] = [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    let cursor = byId.get(activeGroupId);
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor.id)) {
      guard.add(cursor.id);
      trail.unshift(cursor.name);
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return trail.join(" › ");
  }, [activeGroupId, groups, t]);

  /**
   * Folders are nested, so the grid shows ONE level at a time: the folders
   * whose parent is the folder we are in, plus the books filed directly in it.
   *
   * Empty folders are shown. Hiding them is what made this feature invisible:
   * you could make a folder, see nothing change, and conclude it had not
   * worked.
   */
  const groupedEntries = useMemo(() => {
    if (hasSearch || !isGroupView) return [];
    const childBookCount = (groupId: string): number => {
      const direct = filteredBooks.filter((book) => book.groupId === groupId).length;
      const nested = groups
        .filter((g) => g.parentId === groupId)
        .reduce((sum, g) => sum + childBookCount(g.id), 0);
      return direct + nested;
    };
    return groups
      .filter((group) => (group.parentId ?? null) === (activeGroupId || null))
      .map((group) => ({
        type: "group" as const,
        group,
        books: filteredBooks.filter((book) => book.groupId === group.id),
        totalCount: childBookCount(group.id),
      }));
  }, [activeGroupId, filteredBooks, groups, hasSearch, isGroupView]);

  const visibleBooks = useMemo(
    () =>
      isGroupView && !hasSearch
        ? filteredBooks.filter((book) => (book.groupId ?? null) === (activeGroupId || null))
        : filteredBooks,
    [activeGroupId, filteredBooks, isGroupView, hasSearch],
  );

  const gridItems = useMemo<LibraryGridItem[]>(
    () =>
      isGroupView && !hasSearch
        ? [...groupedEntries, ...visibleBooks.map((book) => ({ type: "book" as const, book }))]
        : visibleBooks.map((book) => ({ type: "book" as const, book })),
    [groupedEntries, isGroupView, visibleBooks, hasSearch],
  );

  const handleLocalImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/epub+zip",
          "application/pdf",
          "application/x-mobipocket-ebook",
          "application/vnd.amazon.ebook",
          "application/vnd.comicbook+zip",
          "application/x-fictionbook+xml",
          "text/plain",
          "application/octet-stream",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const files = result.assets.map((a) => ({ uri: a.uri, name: a.name }));
      const summary = await importBooks(files);
      Alert.alert(
        t("common.success", "成功！"),
        t("library.importResultSummary", {
          imported: summary.imported.length,
          skipped: summary.skippedDuplicates.length,
          failed: summary.failures.length,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Different document picking in progress")) {
        console.error("Import failed:", err);
      }
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, [importBooks, t]);

  /**
   * Import every book in a folder, recursively. The document picker can only
   * multi-select files, so a shelf had to be tapped in one by one.
   */
  const handleFolderImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);
    try {
      const { pickFolderBooks } = await import("@/lib/library/folder-import");
      const candidates = await pickFolderBooks();
      if (!candidates) return;
      if (candidates.length === 0) {
        Alert.alert(
          t("library.importSourceFolder", "Import a folder"),
          t("library.folderImportEmpty", "No books were found in that folder."),
        );
        return;
      }
      const summary = await importBooks(candidates);
      Alert.alert(
        t("common.success", "成功！"),
        t("library.importResultSummary", {
          imported: summary.imported.length,
          skipped: summary.skippedDuplicates.length,
          failed: summary.failures.length,
        }),
      );
    } catch (err) {
      console.error("Folder import failed:", err);
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, [importBooks, t]);

  const handlePickLocalFromSourceMenu = useCallback(() => {
    if (localImportInFlightRef.current || pendingLocalImport) return;
    setPendingLocalImport(true);
    setSourceSheetOpen(false);
  }, [pendingLocalImport]);

  useEffect(() => {
    if (Platform.OS === "ios" || !pendingLocalImport || sourceSheetOpen) return;

    const timer = setTimeout(() => {
      setPendingLocalImport(false);
      void handleLocalImport();
    }, 180);

    return () => clearTimeout(timer);
  }, [handleLocalImport, pendingLocalImport, sourceSheetOpen]);

  const handleSourceSheetDismiss = useCallback(() => {
    if (!pendingLocalImport || Platform.OS !== "ios") return;

    requestAnimationFrame(() => {
      setPendingLocalImport(false);
      void handleLocalImport();
    });
  }, [handleLocalImport, pendingLocalImport]);

  const handleOpenImportSources = useCallback((anchorRef?: RefObject<View | null>) => {
    const openWithFallback = () => {
      setSourceSheetAnchor(null);
      setSourceSheetOpen(true);
    };

    if (!anchorRef?.current || typeof anchorRef.current.measureInWindow !== "function") {
      openWithFallback();
      return;
    }

    anchorRef.current.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].some((value) => Number.isNaN(value) || value <= 0)) {
        openWithFallback();
        return;
      }

      setSourceSheetAnchor({ x, y, width, height });
      setSourceSheetOpen(true);
    });
  }, []);

  const handleOpenSavedWebDav = useCallback(async () => {
    setSourceSheetOpen(false);

    if (syncBackendType !== "webdav" || syncConfig?.type !== "webdav") {
      Alert.alert(
        t("library.importSourceSavedWebDavMissingTitle", "还没有可用的 WebDAV 书库"),
        t(
          "library.importSourceSavedWebDavMissing",
          "还没有可用的 WebDAV 配置，先去同步设置里连上你的书库。",
        ),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("settings.syncTitle", "WebDAV 同步"),
            onPress: () => nav.navigate("SyncSettings"),
          },
        ],
      );
      return;
    }

    const platform = getPlatformService();
    const password = await platform.kvGetItem(SYNC_SECRET_KEYS.webdav);
    if (!password) {
      Alert.alert(
        t("library.importSourceSavedWebDavMissingTitle", "还没有可用的 WebDAV 书库"),
        t(
          "library.importSourceSavedWebDavMissingSecret",
          "已经找到 WebDAV 地址，但缺少密码。去同步设置里重新保存一次就能继续。",
        ),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("settings.syncTitle", "WebDAV 同步"),
            onPress: () => nav.navigate("SyncSettings"),
          },
        ],
      );
      return;
    }

    const source: WebDavImportSource = {
      kind: "saved",
      url: deriveImportBaseUrl(syncConfig.url, syncConfig.remoteRoot),
      username: syncConfig.username,
      password,
      remoteRoot: DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
      allowInsecure: syncConfig.allowInsecure ?? false,
    };
    nav.navigate("WebDavImportBrowser", { source });
  }, [nav, syncBackendType, syncConfig, t]);

  const handleOpenTemporaryWebDav = useCallback(() => {
    setSourceSheetOpen(false);
    setTemporaryWebDavOpen(true);
  }, []);

  const handleConnectTemporaryWebDav = useCallback(
    async (source: WebDavImportSource) => {
      const { WebDavImportService } = await import("@readany/core");
      const service = new WebDavImportService(source);
      await service.testConnection();
      setTemporaryWebDavOpen(false);
      nav.navigate("WebDavImportBrowser", { source });
    },
    [nav],
  );

  const handleOpen = useCallback(
    async (book: Book) => {
      if (showSearch) {
        searchAnim.setValue(0);
        setShowSearch(false);
        setFilter({ search: "" });
        Keyboard.dismiss();
      }
      if (book.syncStatus === "remote") {
        await downloadBook(book);
        return;
      }
      await openMobileBook({ bookId: book.id, navigation: nav, t });
    },
    [downloadBook, nav, t, showSearch, searchAnim, setFilter],
  );

  const handleManageTags = useCallback((book: Book) => {
    setTagSheetBook(book);
    setTagSheetOpen(true);
  }, []);

  const handleShowDetails = useCallback(
    (book: Book) => {
      if (showSearch) {
        searchAnim.setValue(0);
        setShowSearch(false);
        setFilter({ search: "" });
        Keyboard.dismiss();
      }
      nav.navigate("BookDetails", { bookId: book.id });
    },
    [nav, searchAnim, setFilter, showSearch],
  );

  const handleSortChange = useCallback(
    (field: SortField) => {
      const next =
        filter.sortField === field
          ? { sortField: field, sortOrder: (filter.sortOrder === "asc" ? "desc" : "asc") as SortOrder }
          : {
              sortField: field,
              sortOrder: (field === "title" || field === "author" ? "asc" : "desc") as SortOrder,
            };
      setFilter(next);
      // Sorting chosen inside a folder belongs to that folder: a shelf of
      // manga wants a different order from a shelf of textbooks.
      if (activeGroupId) setGroupViewPrefs(activeGroupId, next);
      setShowSort(false);
    },
    [activeGroupId, filter, setFilter, setGroupViewPrefs],
  );

  /**
   * Entering a folder applies its remembered sort; leaving restores the
   * library's own. Without the restore, the last folder opened would quietly
   * become the library default.
   */
  const libraryFilterRef = useRef<{ sortField: SortField; sortOrder: SortOrder } | null>(null);
  useEffect(() => {
    if (activeGroupId) {
      const prefs = groups.find((g) => g.id === activeGroupId)?.viewPrefs;
      if (!libraryFilterRef.current) {
        libraryFilterRef.current = { sortField: filter.sortField, sortOrder: filter.sortOrder };
      }
      if (prefs?.sortField) {
        setFilter({ sortField: prefs.sortField, sortOrder: prefs.sortOrder ?? "desc" });
      }
    } else if (libraryFilterRef.current) {
      setFilter(libraryFilterRef.current);
      libraryFilterRef.current = null;
    }
    // Only on entering or leaving a folder — not on every sort change, which
    // would immediately undo the change being made.
  }, [activeGroupId]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * A folder may prefer a different layout from the library — a shelf of
   * reference books reads better as a list than as a wall of covers.
   */
  const isListView = useMemo(() => {
    if (activeGroupId) {
      const prefs = groups.find((g) => g.id === activeGroupId)?.viewPrefs;
      if (prefs?.viewMode) return prefs.viewMode === "list";
    }
    return viewMode === "list";
  }, [activeGroupId, groups, viewMode]);

  const toggleListView = useCallback(() => {
    const next = isListView ? "grid" : "list";
    if (activeGroupId) setGroupViewPrefs(activeGroupId, { viewMode: next });
    else setViewMode(next);
  }, [activeGroupId, isListView, setGroupViewPrefs, setViewMode]);

  const isEmpty = gridItems.length === 0;
  const hasBooks = books.length > 0;

  const toggleBookSelection = useCallback((book: Book) => {
    setSelectedBookIds((prev) => {
      const next = new Set(prev);
      if (next.has(book.id)) next.delete(book.id);
      else next.add(book.id);
      return next;
    });
  }, []);

  const enterSelectionMode = useCallback((book: Book) => {
    setSelectionMode(true);
    setSelectedBookIds(new Set([book.id]));
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedBookIds(new Set());
  }, []);

  const isAllSelected = visibleBooks.length > 0 && selectedBookIds.size === visibleBooks.length;

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedBookIds(new Set());
    } else {
      setSelectedBookIds(new Set(visibleBooks.map((b) => b.id)));
    }
  }, [visibleBooks, isAllSelected]);

  const handleBatchDelete = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    Alert.alert(
      t("common.confirm", "确认"),
      t("library.batchDeleteConfirm", `确定要删除选中的 ${selectedBookIds.size} 本书吗？`),
      [
        { text: t("common.cancel", "取消"), style: "cancel" },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: async () => {
            for (const id of selectedBookIds) {
              await removeBook(id);
            }
            exitSelectionMode();
          },
        },
      ],
    );
  }, [selectedBookIds, removeBook, exitSelectionMode, t]);

  const handleBatchTag = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    const selectedBooks = books.filter((b) => selectedBookIds.has(b.id));
    setTagSheetBook(selectedBooks[0] ?? null);
    setBatchTagBookIds([...selectedBookIds]);
    setTagSheetOpen(true);
  }, [selectedBookIds, books]);

  const handleBatchVectorize = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    const selectedBooks = books.filter((b) => selectedBookIds.has(b.id));
    for (const book of selectedBooks) {
      handleVectorize(book);
    }
    exitSelectionMode();
  }, [selectedBookIds, books, handleVectorize, exitSelectionMode]);

  const openGroupNameModal = useCallback((mode: "create" | "rename", group?: BookGroup) => {
    setGroupNameInput(group?.name ?? "");
    setGroupNameModal({ mode, group });
  }, []);

  const submitGroupName = useCallback(async () => {
    const trimmed = groupNameInput.trim();
    if (!trimmed || !groupNameModal) return;
    if (groupNameModal.mode === "create") {
      // A folder made while inside another one becomes its child, which is how
      // nesting is reached without a separate "new subfolder" command.
      const created = await addGroup(trimmed, activeGroupId || undefined);
      if (!created) {
        // Silence here is indistinguishable from the folder simply not
        // appearing, which is the exact confusion this feature already had.
        Alert.alert(
          t("library.newFolder", "New folder"),
          t("library.folderCreateFailed", "That folder could not be created."),
        );
        return;
      }
      setGroupView(true);
    } else if (groupNameModal.group) {
      renameGroup(groupNameModal.group.id, trimmed);
    }
    setGroupNameInput("");
    setGroupNameModal(null);
  }, [activeGroupId, addGroup, groupNameInput, groupNameModal, renameGroup, setGroupView]);

  const handleGroupLongPress = useCallback(
    (group: BookGroup) => {
      Alert.alert(group.name, undefined, [
        {
          text: t("common.rename", "重命名"),
          onPress: () => openGroupNameModal("rename", group),
        },
        {
          text: t("library.folderColor", "Colour"),
          onPress: () => setColorPickerGroup(group),
        },
        {
          text: t("common.delete", "删除"),
          style: "destructive",
          onPress: () => void removeGroup(group.id),
        },
        { text: t("common.cancel", "取消"), style: "cancel" },
      ]);
    },
    [openGroupNameModal, removeGroup, t],
  );

  const handleBatchMoveGroup = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    setShowGroupPicker(true);
  }, [selectedBookIds]);

  const handleGroupPickerSelect = useCallback(
    (groupId: string | undefined) => {
      moveBooksToGroup([...selectedBookIds], groupId);
      exitSelectionMode();
    },
    [exitSelectionMode, moveBooksToGroup, selectedBookIds],
  );

  const handleGroupPickerCreate = useCallback(
    async (name: string) => {
      const group = await addGroup(name);
      if (group) {
        moveBooksToGroup([...selectedBookIds], group.id);
        exitSelectionMode();
      }
    },
    [addGroup, exitSelectionMode, moveBooksToGroup, selectedBookIds],
  );

  const handleBatchRemoveFromGroup = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    moveBooksToGroup([...selectedBookIds], undefined);
    exitSelectionMode();
  }, [exitSelectionMode, moveBooksToGroup, selectedBookIds]);

  const renderListItem = useCallback(
    ({ item }: { item: LibraryGridItem }) =>
      item.type === "group" ? (
        <LibraryListRow
          group={item.group}
          bookCount={item.totalCount ?? item.books.length}
          onPress={() => setActiveGroupId(item.group.id)}
          onLongPress={() => handleGroupLongPress(item.group)}
        />
      ) : (
        <LibraryListRow
          book={item.book}
          selected={selectedBookIds.has(item.book.id)}
          onPress={() =>
            selectionMode ? toggleBookSelection(item.book) : handleOpen(item.book)
          }
          onLongPress={() => (selectionMode ? undefined : enterSelectionMode(item.book))}
        />
      ),
    [
      enterSelectionMode,
      handleGroupLongPress,
      handleOpen,
      selectedBookIds,
      selectionMode,
      setActiveGroupId,
      toggleBookSelection,
    ],
  );

  const renderGridItem = useCallback(
    ({ item }: { item: LibraryGridItem }) => (
      <View style={s.gridItem}>
        {item.type === "group" ? (
          <GroupCard
            group={item.group}
            books={item.books}
            totalCount={item.totalCount}
            cardWidth={gridItemWidth}
            onOpen={setActiveGroupId}
            onLongPress={handleGroupLongPress}
          />
        ) : (
          <BookCard
            book={item.book}
            cardWidth={gridItemWidth}
            onOpen={handleOpen}
            onDelete={removeBook}
            onShowDetails={handleShowDetails}
            onManageTags={handleManageTags}
            onVectorize={handleVectorize}
            isVectorizing={vectorizingBookId === item.book.id}
            isQueued={vectorQueue.some((b) => b.id === item.book.id)}
            vectorProgress={vectorizingBookId === item.book.id ? vectorProgress : null}
            downloadProgress={downloadingBookId === item.book.id ? downloadProgress : null}
            isSelectionMode={selectionMode}
            isSelected={selectedBookIds.has(item.book.id)}
            onSelect={toggleBookSelection}
            onLongPress={selectionMode ? undefined : enterSelectionMode}
          />
        )}
      </View>
    ),
    [
      enterSelectionMode,
      gridItemWidth,
      handleGroupLongPress,
      handleManageTags,
      handleShowDetails,
      handleOpen,
      handleVectorize,
      removeBook,
      s.gridItem,
      selectedBookIds,
      selectionMode,
      setActiveGroupId,
      toggleBookSelection,
      vectorProgress,
      vectorQueue,
      vectorizingBookId,
      downloadingBookId,
      downloadProgress,
    ],
  );

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      <ExtractorWebView ref={extractorRef} />

      {/* Header */}
      <View style={[s.header, { zIndex: 20 }]}>
        <View style={s.headerInner}>
          {selectionMode ? (
            <View style={s.headerRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <TouchableOpacity style={s.headerBtn} onPress={exitSelectionMode}>
                  <XIcon size={18} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={s.headerTitle}>
                  {t("library.selectedCount", {
                    count: selectedBookIds.size,
                    defaultValue: `已选 ${selectedBookIds.size} 本`,
                  })}
                </Text>
              </View>
              <View style={s.headerActions}>
                <TouchableOpacity style={s.headerBtn} onPress={toggleSelectAll}>
                  <CheckCheckIcon
                    size={18}
                    color={isAllSelected ? colors.primary : colors.mutedForeground}
                  />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={handleBatchTag}>
                  <HashIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={handleBatchMoveGroup}>
                  <FolderInputIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                {activeGroupId ? (
                  <TouchableOpacity style={s.headerBtn} onPress={handleBatchRemoveFromGroup}>
                    <FolderMinusIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={s.headerBtn} onPress={handleBatchVectorize}>
                  <DatabaseIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtn} onPress={handleBatchDelete}>
                  <Trash2Icon size={18} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={s.headerRow}>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1, minWidth: 0 }}
              >
                {activeGroup && (
                  <TouchableOpacity
                    style={s.headerBtn}
                    onPress={() => setActiveGroupId(activeGroup.parentId ?? "")}
                  >
                    <ChevronLeftIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
                <Text style={s.headerTitle} numberOfLines={1}>
                  {folderPathLabel}
                </Text>
              </View>
              <View style={s.headerActions}>
                <SyncButton size={18} color={colors.mutedForeground} />
                {hasBooks && (
                  <TouchableOpacity
                    style={s.headerBtn}
                    onPress={() => setShowLibraryMenu(true)}
                    accessibilityLabel={t("library.menu", "Library options")}
                  >
                    <MoreVerticalIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
                <View ref={importButtonAnchorRef} collapsable={false}>
                  <TouchableOpacity
                    style={s.importBtn}
                    onPress={() => handleOpenImportSources(importButtonAnchorRef)}
                    disabled={isImporting || isPickingImport}
                    activeOpacity={0.8}
                  >
                    {isImporting || isPickingImport ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <PlusIcon size={18} color={colors.primaryForeground} />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}

          {hasBooks && ((!selectionMode && showSearch) || allTags.length > 0) && (
            <View style={s.searchTagSection}>
              {!selectionMode && showSearch && (
                <Animated.View
                  style={[
                    s.searchInputContainer,
                    layout.isTablet ? s.searchInputContainerWide : null,
                    {
                      opacity: searchAnim,
                      transform: [
                        {
                          translateY: searchAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [-4, 0],
                          }),
                        },
                      ],
                    },
                  ]}
                >
                  <SearchIcon size={16} color={colors.mutedForeground} />
                  <TextInput
                    ref={searchInputRef}
                    style={s.searchInput}
                    placeholder={t("library.searchPlaceholder", "搜索...")}
                    placeholderTextColor={colors.mutedForeground}
                    value={filter.search}
                    onChangeText={(text) => setFilter({ search: text })}
                    onBlur={() => {
                      if (!filter.search.trim()) closeSearch();
                    }}
                    returnKeyType="search"
                  />
                  {filter.search.length > 0 && (
                    <TouchableOpacity
                      style={s.searchClearBtn}
                      onPress={() => {
                        setFilter({ search: "" });
                        searchInputRef.current?.focus();
                      }}
                      hitSlop={6}
                    >
                      <XIcon size={14} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </Animated.View>
              )}
              {allTags.length > 0 && (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={[s.tagScroll, layout.isTablet ? s.tagScrollWide : null]}
                  contentContainerStyle={s.tagScrollContent}
                >
                  <TouchableOpacity
                    style={[s.tagChip, !activeTag && !activeGroupId && s.tagChipActive]}
                    onPress={() => setActiveTag("")}
                  >
                    <Text
                      style={[s.tagChipText, !activeTag && !activeGroupId && s.tagChipTextActive]}
                    >
                      {t("library.all", "全部")}
                    </Text>
                  </TouchableOpacity>
                  {allTags.map((tag) => (
                    <TouchableOpacity
                      key={tag}
                      style={[s.tagChip, activeTag === tag && s.tagChipActive]}
                      onPress={() => setActiveTag(activeTag === tag ? "" : tag)}
                    >
                      <Text style={[s.tagChipText, activeTag === tag && s.tagChipTextActive]}>
                        {tag}
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    style={[s.tagChip, activeTag === "__uncategorized__" && s.tagChipActive]}
                    onPress={() =>
                      setActiveTag(activeTag === "__uncategorized__" ? "" : "__uncategorized__")
                    }
                  >
                    <Text
                      style={[
                        s.tagChipText,
                        activeTag === "__uncategorized__" && s.tagChipTextActive,
                      ]}
                    >
                      {t("sidebar.uncategorized", "未分类")}
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          )}
        </View>
      </View>

      {/* Sort dropdown */}
      <Modal
        visible={showSort}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSort(false)}
      >
        <Pressable style={s.sortOverlay} onPress={() => setShowSort(false)} />
        <View style={s.sortDropdown}>
          {SORT_OPTIONS.map(({ field, labelKey }) => (
            <TouchableOpacity
              key={field}
              style={[s.sortItem, filter.sortField === field && s.sortItemActive]}
              onPress={() => handleSortChange(field)}
            >
              {field === "lastOpenedAt" ? (
                <ClockIcon size={14} color={colors.mutedForeground} />
              ) : filter.sortField === field && filter.sortOrder === "asc" ? (
                <ArrowUpAZIcon size={14} color={colors.mutedForeground} />
              ) : (
                <ArrowDownAZIcon size={14} color={colors.mutedForeground} />
              )}
              <Text style={[s.sortText, filter.sortField === field && s.sortTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Content */}
      <View style={s.content}>
        <View style={s.contentInner}>
          {!isLoaded && (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={colors.mutedForeground} />
            </View>
          )}
          {isImporting && (
            <View style={s.importBanner}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.importBannerText}>{t("library.importing", "正在导入...")}</Text>
            </View>
          )}
          {isLoaded && books.length === 0 && (
            <View style={s.emptyWrap}>
              <Image
                source={cafeIllustration()}
                style={{ width: 300, height: 224, borderRadius: radius.lg }}
                resizeMode="contain"
              />
              <Text style={s.emptyTitle}>{t("library.empty", "暂无书籍")}</Text>
              <Text style={s.emptyHint}>{t("library.emptyHint", "导入电子书开始阅读之旅")}</Text>
              <View ref={emptyImportAnchorRef} collapsable={false}>
                <TouchableOpacity
                  style={s.emptyImportBtn}
                  onPress={() => handleOpenImportSources(emptyImportAnchorRef)}
                  disabled={isPickingImport}
                  activeOpacity={0.8}
                >
                  <Text style={s.emptyImportText}>{t("library.importFirst", "导入书籍")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {isLoaded && hasBooks && isEmpty && (
            <View style={s.noResultsWrap}>
              <SearchIcon size={40} color={withOpacity(colors.mutedForeground, 0.3)} />
              <Text style={s.noResultsText}>{t("library.noResults", "没有找到匹配的书籍")}</Text>
            </View>
          )}
          {isLoaded && hasBooks && filter.search && !isEmpty && (
            <Text style={s.resultsCount}>
              {t("library.resultsCount", { count: gridItems.length })}
            </Text>
          )}
          {isLoaded && !isEmpty && (
            <FlatList
              data={gridItems}
              renderItem={isListView ? renderListItem : renderGridItem}
              extraData={{ vectorProgress, vectorizingBookId }}
              keyExtractor={(item) =>
                item.type === "group" ? `group-${item.group.id}` : item.book.id
              }
              // FlatList will not change numColumns in place, so the key must
              // change with it or the list keeps its old layout.
              key={`library-${isListView ? "list" : `grid-${columnCount}`}`}
              numColumns={isListView ? 1 : columnCount}
              columnWrapperStyle={isListView ? undefined : s.gridRow}
              contentContainerStyle={s.gridContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            />
          )}
        </View>
      </View>

      <Modal
        visible={!!groupNameModal}
        transparent
        animationType="fade"
        onRequestClose={() => setGroupNameModal(null)}
      >
        <KeyboardAvoidingView style={s.groupModalKeyboardRoot} behavior="height">
          <Pressable style={s.groupModalOverlay} onPress={() => setGroupNameModal(null)}>
            <Pressable style={s.groupModalCard} onPress={() => {}}>
              <Text style={s.groupModalTitle}>
                {groupNameModal?.mode === "rename"
                  ? t("common.rename", "重命名")
                  : t("library.createGroup", "新建分组")}
              </Text>
              <TextInput
                style={s.groupModalInput}
                value={groupNameInput}
                onChangeText={setGroupNameInput}
                placeholder={t("library.groupNamePrompt", "分组名称")}
                placeholderTextColor={colors.mutedForeground}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => void submitGroupName()}
              />
              <View style={s.groupModalActions}>
                <TouchableOpacity
                  style={s.groupModalSecondary}
                  onPress={() => setGroupNameModal(null)}
                >
                  <Text style={s.groupModalSecondaryText}>{t("common.cancel", "取消")}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={s.groupModalPrimary}
                  onPress={() => void submitGroupName()}
                >
                  <Text style={s.groupModalPrimaryText}>{t("common.confirm", "确定")}</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <TagManagementSheet
        visible={tagSheetOpen}
        book={tagSheetBook}
        allTags={allTags}
        batchBookIds={batchTagBookIds.length > 0 ? batchTagBookIds : undefined}
        onClose={() => {
          setTagSheetOpen(false);
          setBatchTagBookIds([]);
        }}
        onAddTag={addTag}
        onAddTagToBook={addTagToBook}
        onRemoveTagFromBook={removeTagFromBook}
        onRemoveTag={removeTag}
        onRenameTag={renameTag}
      />
      <WebDavImportSourceSheet
        visible={sourceSheetOpen}
        hasSavedWebDav={syncBackendType === "webdav" && syncConfig?.type === "webdav"}
        anchor={sourceSheetAnchor}
        localImportBusy={isPickingImport}
        onClose={() => setSourceSheetOpen(false)}
        onDismiss={handleSourceSheetDismiss}
        onPickLocal={handlePickLocalFromSourceMenu}
        onPickFolder={() => {
          setSourceSheetOpen(false);
          void handleFolderImport();
        }}
        onPickSavedWebDav={() => void handleOpenSavedWebDav()}
        onPickTemporaryWebDav={handleOpenTemporaryWebDav}
      />
      <WebDavConnectSheet
        visible={temporaryWebDavOpen}
        onClose={() => setTemporaryWebDavOpen(false)}
        onSubmit={handleConnectTemporaryWebDav}
      />
      <LibraryMenuSheet
        visible={showLibraryMenu}
        isGroupView={isGroupView}
        isListView={isListView}
        canCreateFolder={isGroupView}
        onClose={() => setShowLibraryMenu(false)}
        onSearch={() => (showSearch ? closeSearch() : openSearch())}
        onSort={() => setShowSort(true)}
        onToggleFolders={() => {
          setActiveGroupId("");
          setGroupView(!isGroupView);
        }}
        onToggleListView={toggleListView}
        onNewFolder={() => openGroupNameModal("create")}
      />
      <FolderColorSheet
        group={colorPickerGroup}
        onPick={(color) => {
          const target = colorPickerGroup;
          setColorPickerGroup(null);
          if (!target) return;
          void setGroupColor(target.id, color).catch((err) => {
            Alert.alert(
              t("library.folderColor", "Colour"),
              err instanceof Error ? err.message : String(err),
            );
          });
        }}
        onClose={() => setColorPickerGroup(null)}
      />
      <GroupPickerSheet
        visible={showGroupPicker}
        groups={groups}
        onSelect={handleGroupPickerSelect}
        onCreateGroup={handleGroupPickerCreate}
        onClose={() => setShowGroupPicker(false)}
      />
    </SafeAreaView>
  );
}

const makeStyles = (
  colors: ThemeColors,
  layout: {
    horizontalPadding: number;
    contentWidth: number;
    gridGap: number;
    gridItemWidth: number;
    isWideScreen: boolean;
  },
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: layout.horizontalPadding,
      paddingTop: 12,
      paddingBottom: 8,
      alignItems: "center",
    },
    headerInner: { width: "100%", maxWidth: layout.contentWidth },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    importBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    searchTagSection: {
      flexDirection: layout.isWideScreen ? "row" : "column",
      alignItems: layout.isWideScreen ? "center" : "stretch",
      gap: layout.isWideScreen ? 12 : 6,
      marginBottom: 4,
    },
    searchInputContainer: {
      flexDirection: "row",
      alignItems: "center",
      height: 36,
      paddingHorizontal: 10,
      gap: 6,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    searchInputContainerWide: {
      width: 280,
    },
    searchInput: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
      padding: 0,
      minWidth: 0,
    },
    searchClearBtn: {
      width: 22,
      height: 22,
      borderRadius: 11,
      alignItems: "center",
      justifyContent: "center",
    },
    tagScroll: { marginBottom: 4 },
    tagScrollWide: { flex: 1, minWidth: 0, marginBottom: 0 },
    tagScrollContent: { gap: 6, paddingRight: 8 },
    tagChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    tagChipActive: { backgroundColor: colors.primary },
    tagChipText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    tagChipTextActive: { color: colors.primaryForeground },
    sortOverlay: { flex: 1 },
    sortDropdown: {
      position: "absolute",
      top: 110,
      right: layout.horizontalPadding,
      minWidth: 180,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 4,
      elevation: 5,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    sortItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    sortItemActive: { backgroundColor: colors.muted },
    sortText: { fontSize: fontSize.xs, color: colors.foreground },
    sortTextActive: { fontWeight: fontWeight.medium },
    content: { flex: 1, paddingHorizontal: layout.horizontalPadding, alignItems: "center" },
    contentInner: { flex: 1, width: "100%", maxWidth: layout.contentWidth },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    importBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: `${colors.muted}0D`,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 12,
    },
    importBannerText: { fontSize: fontSize.xs, color: colors.primary },
    vecBanner: {
      backgroundColor: `${colors.muted}0D`,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    vecBannerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    vecBannerInfo: { flex: 1, minWidth: 0 },
    vecBannerStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    vecBannerStatus: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    vecBannerTitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    vecProgressBg: {
      height: 4,
      backgroundColor: `${colors.muted}1A`,
      borderRadius: radius.full,
      marginTop: 8,
      overflow: "hidden",
    },
    vecProgressFill: { height: 4, backgroundColor: colors.primary, borderRadius: radius.full },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyIconWrap: {
      width: 80,
      height: 80,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 8,
    },
    emptyHint: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      maxWidth: 240,
      marginBottom: 24,
    },
    emptyImportBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    emptyImportText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    noResultsWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 80 },
    noResultsText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 12 },
    resultsCount: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 8 },
    gridRow: { gap: layout.gridGap, justifyContent: "flex-start" },
    gridContent: { paddingBottom: 24, paddingTop: 4, width: "100%" },
    gridItem: { width: layout.gridItemWidth, marginBottom: layout.gridGap },
    groupModalKeyboardRoot: { flex: 1 },
    groupModalOverlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.24)",
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: 24,
    },
    groupModalCard: {
      width: "100%",
      maxWidth: 360,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      backgroundColor: colors.card,
      padding: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.2,
      shadowRadius: 18,
      elevation: 12,
    },
    groupModalTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 12,
    },
    groupModalInput: {
      height: 42,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.foreground,
      paddingHorizontal: 12,
      fontSize: fontSize.sm,
      backgroundColor: colors.background,
    },
    groupModalActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 8,
      marginTop: 14,
    },
    groupModalSecondary: {
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.muted,
    },
    groupModalSecondaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.foreground,
    },
    groupModalPrimary: {
      height: 36,
      paddingHorizontal: 16,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.primary,
    },
    groupModalPrimaryText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
  });
