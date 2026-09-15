import { BookCard } from "@/components/library/BookCard";
import { ContinueReadingCard } from "@/components/library/ContinueReadingCard";
import { FolderColorSheet } from "@/components/library/FolderColorSheet";
import { GroupCard } from "@/components/library/GroupCard";
import { GroupPickerSheet } from "@/components/library/GroupPickerSheet";
import { ImportDestinationSheet } from "@/components/library/ImportDestinationSheet";
import type { ImportDestination } from "@/components/library/ImportDestinationSheet";
import { LibraryListRow } from "@/components/library/LibraryListRow";
import { LibraryMenuSheet } from "@/components/library/LibraryMenuSheet";
import { PdfCoverWebView } from "@/components/library/PdfCoverWebView";
import type { PdfCoverWebViewHandle } from "@/components/library/PdfCoverWebView";
import { ShelfScopeSheet } from "@/components/library/ShelfScopeSheet";
import { ShelfTile } from "@/components/library/ShelfTile";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  CheckCheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ClockIcon,
  DatabaseIcon,
  FolderInputIcon,
  FolderMinusIcon,
  HashIcon,
  LayersIcon,
  MoreVerticalIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "@/components/ui/Icon";
import { SyncButton } from "@/components/ui/SyncButton";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { hashBookFile } from "@/lib/file-hash";
import { cafeIllustration } from "@/lib/library/cafe-illustration";
import {
  type HashBackfillProgress,
  backfillFileHashes,
  booksMissingFileHash,
  existingFileHashes,
} from "@/lib/library/file-hash-backfill";
import { isLikelyRelativeAppPath, openMobileBook } from "@/lib/library/open-mobile-book";
import { backfillPdfCovers, coverlessPdfs } from "@/lib/library/pdf-cover-backfill";
import { setCallback, setExtractorRef } from "@/lib/rag/auto-vectorize-service";
import { startFileServer } from "@/lib/reader/local-file-server";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { WebDavConnectSheet } from "@/screens/library/WebDavConnectSheet";
import { WebDavImportSourceSheet } from "@/screens/library/WebDavImportSourceSheet";
import { useLibraryStore } from "@/stores/library-store";
import { expandFolderIds, useShelfStore } from "@/stores/shelf-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  spacing,
  ui,
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
  const contentWidthForShelf = layout.centeredContentWidth;
  const columnCount = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : NUM_COLUMNS;
  /**
   * The shelf sizes itself by how big a cover needs to be to be recognised —
   * about 84dp — rather than by a fixed number of columns, so a phone shows
   * four and a 10" tablet shows ten without either being told to.
   */
  const SHELF_TARGET_TILE = 84;
  const shelfGap = layout.isTablet ? 12 : 8;
  const shelfColumnCount = Math.max(
    3,
    Math.floor((contentWidthForShelf + shelfGap) / (SHELF_TARGET_TILE + shelfGap)),
  );
  const shelfTileWidth = Math.floor(
    (contentWidthForShelf - shelfGap * (shelfColumnCount - 1)) / shelfColumnCount,
  );
  const contentWidth = layout.centeredContentWidth;
  const gridItemWidth = Math.floor((contentWidth - gridGap * (columnCount - 1)) / columnCount);
  const s = useMemo(
    () =>
      makeStyles(colors, {
        horizontalPadding: layout.horizontalPadding,
        contentWidth,
        gridGap,
        gridItemWidth,
        shelfGap,
        isWideScreen: layout.isTablet,
      }),
    [
      colors,
      contentWidth,
      gridGap,
      gridItemWidth,
      shelfGap,
      layout.horizontalPadding,
      layout.isTablet,
    ],
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
  /**
   * Files chosen but not yet imported. The destination sheet sits in this gap,
   * so books can be filed as they arrive instead of being fished back out of
   * the shelf afterwards.
   */
  /**
   * What the import is doing right now. A few hundred books take minutes, and
   * an app that shows nothing for minutes looks broken rather than busy.
   */
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number;
    label: string;
  } | null>(null);
  const [pendingImport, setPendingImport] = useState<{
    files: Array<{ uri: string; name?: string; relativeFolder?: string[] }>;
    suggestedName?: string;
  } | null>(null);
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
    updateBook,
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

  /**
   * Tag and search applied, but NOT the folder filter.
   *
   * Folder tiles must count from this, not from filteredBooks: inside a folder
   * that list contains only that folder's own books, so a subfolder tile could
   * never see its own contents and always read zero.
   */
  const searchableBooks = useMemo(() => {
    let result = [...books];
    if (activeTag === "__uncategorized__") {
      result = result.filter((b) => b.tags.length === 0);
    } else if (activeTag) {
      result = result.filter((b) => b.tags.includes(activeTag));
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
    return result;
  }, [books, activeTag, filter.search]);

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

  /**
   * The book to hand straight back. Most visits to a shelf are not a browse —
   * they are the middle of something — so the most recently opened unfinished
   * book gets a card of its own above the covers. Only at the top of the
   * library, and only when nothing is being searched or filtered: inside a
   * folder or a search the shelf is already an answer to a question, and a
   * card about a different book would be answering a question nobody asked.
   */
  const continueBook = useMemo(() => {
    if (activeGroupId || activeTag || filter.search.trim()) return null;
    // An import stamps lastOpenedAt too, so a book dropped on the shelf a
    // minute ago would otherwise shove aside the one actually being read.
    // Anything started wins; an untouched book is only the answer when
    // nothing is in progress at all.
    let started: Book | null = null;
    let untouched: Book | null = null;
    for (const book of books) {
      if (book.deletedAt) continue;
      if (!book.lastOpenedAt) continue;
      if (book.progress >= 0.995) continue; // finished — offering it back is noise
      if (book.syncStatus === "downloading") continue;
      const slot = book.progress > 0 ? started : untouched;
      if (!slot || (book.lastOpenedAt || 0) > (slot.lastOpenedAt || 0)) {
        if (book.progress > 0) started = book;
        else untouched = book;
      }
    }
    return started ?? untouched;
  }, [books, activeGroupId, activeTag, filter.search]);

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
      const direct = searchableBooks.filter((book) => book.groupId === groupId).length;
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
        // Cover previews also come from the unfiltered list, or a subfolder
        // tile would show an empty stack of covers.
        books: searchableBooks.filter((book) => book.groupId === group.id),
        totalCount: childBookCount(group.id),
      }));
  }, [activeGroupId, searchableBooks, groups, hasSearch, isGroupView]);

  const visibleBooks = useMemo(
    () =>
      isGroupView && !hasSearch
        ? filteredBooks.filter((book) => (book.groupId ?? null) === (activeGroupId || null))
        : filteredBooks,
    [activeGroupId, filteredBooks, isGroupView, hasSearch],
  );

  const shelfMode = useShelfStore((st) => st.mode);
  const shelfGroupIds = useShelfStore((st) => st.groupIds);
  const showEverything = useShelfStore((st) => st.showEverything);
  const toggleShelfFolder = useShelfStore((st) => st.toggleFolder);
  const [scopeSheetOpen, setScopeSheetOpen] = useState(false);

  const isShelfView = viewMode === "shelf" && !activeGroupId;

  /**
   * On the shelf a folder is a filter, not a place: the books come from the
   * whole library and are narrowed to the chosen folders, including everything
   * nested inside them.
   */
  const shelfBooks = useMemo(() => {
    if (!isShelfView) return [];
    if (shelfMode === "all" || shelfGroupIds.length === 0) return filteredBooks;
    const wanted = expandFolderIds(shelfGroupIds, groups);
    return filteredBooks.filter((book) => book.groupId && wanted.has(book.groupId));
  }, [isShelfView, shelfMode, shelfGroupIds, filteredBooks, groups]);

  const gridItems = useMemo<LibraryGridItem[]>(() => {
    // The shelf is a flat wall of covers; folders filter it rather than appear in it.
    if (isShelfView) return shelfBooks.map((book) => ({ type: "book" as const, book }));
    return isGroupView && !hasSearch
      ? [...groupedEntries, ...visibleBooks.map((book) => ({ type: "book" as const, book }))]
      : visibleBooks.map((book) => ({ type: "book" as const, book }));
  }, [groupedEntries, isGroupView, visibleBooks, hasSearch, isShelfView, shelfBooks]);

  /**
   * Import the staged files and file them where the sheet said. The folder is
   * applied after the import because the books do not have ids until then.
   */
  const runStagedImport = useCallback(
    async (destination: ImportDestination) => {
      const staged = pendingImport;
      setPendingImport(null);
      if (!staged) return;

      setIsPickingImport(true);
      try {
        let groupId: string | undefined;
        let destinationLabel = "";
        if (destination.kind === "existing") {
          groupId = destination.groupId;
        } else if (destination.kind === "new") {
          const created = await addGroup(destination.name, destination.parentId);
          if (!created) {
            Alert.alert(
              t("common.error", "Error"),
              t("library.folderCreateFailed", "That folder could not be created."),
            );
            return;
          }
          groupId = created.id;
          destinationLabel = destination.name;
        }

        /**
         * Find or make the chain of folders a file sat in on disk.
         * Looked up by name under its parent each time, so a second import of
         * the same shelf lands in the folders that already exist rather than
         * building a parallel set beside them.
         */
        const ensureFolderPath = async (
          segments: string[],
          rootId: string | undefined,
        ): Promise<string | undefined> => {
          let parentId = rootId;
          for (const segment of segments) {
            const name = segment.trim();
            if (!name) continue;
            const existing = useLibraryStore
              .getState()
              .groups.find(
                (group) =>
                  group.name === name && (group.parentId ?? undefined) === (parentId ?? undefined),
              );
            if (existing) {
              parentId = existing.id;
              continue;
            }
            const created = await addGroup(name, parentId);
            if (!created) return parentId;
            parentId = created.id;
          }
          return parentId;
        };

        // Imported one folder at a time: importBooks skips duplicates, so the
        // books it returns cannot be matched back to the files that went in.
        // Keeping each folder's import separate keeps the mapping exact.
        const byFolder = new Map<string, typeof staged.files>();
        for (const file of staged.files) {
          const path = (file.relativeFolder || []).join("/");
          const bucket = byFolder.get(path);
          if (bucket) bucket.push(file);
          else byFolder.set(path, [file]);
        }

        let imported = 0;
        let skipped = 0;
        let failed = 0;
        let done = 0;
        const total = staged.files.length;
        for (const [path, files] of byFolder) {
          setImportProgress({
            done,
            total,
            label: path || destinationLabel || t("library.importing", "Importing"),
          });
          const target = path ? await ensureFolderPath(path.split("/"), groupId) : groupId;
          const summary = await importBooks(files);
          imported += summary.imported.length;
          skipped += summary.skippedDuplicates.length;
          failed += summary.failures.length;
          if (target && summary.imported.length > 0) {
            moveBooksToGroup(
              summary.imported.map((book) => book.id),
              target,
            );
          }
          done += files.length;
        }
        setImportProgress(null);

        Alert.alert(
          t("common.success", "成功！"),
          t("library.importResultSummary", { imported, skipped, failed }),
        );
      } catch (err) {
        console.error("Import failed:", err);
        Alert.alert(t("common.error", "Error"), err instanceof Error ? err.message : String(err));
      } finally {
        setImportProgress(null);
        setIsPickingImport(false);
      }
    },
    [pendingImport, addGroup, importBooks, moveBooksToGroup, t],
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
      setPendingImport({
        files: result.assets.map((a) => ({ uri: a.uri, name: a.name })),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Different document picking in progress")) {
        console.error("Import failed:", err);
      }
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, []);

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
      setImportProgress({ done: 0, total: 0, label: t("library.scanning", "Looking for books…") });
      const pick = await pickFolderBooks((found) => {
        setImportProgress({
          done: found,
          total: 0,
          label: t("library.scanning", "Looking for books…"),
        });
      });
      setImportProgress(null);
      if (!pick) return;
      if (pick.candidates.length === 0) {
        Alert.alert(
          t("library.importSourceFolder", "Import a folder"),
          t("library.folderImportEmpty", "No books were found in that folder."),
        );
        return;
      }
      setPendingImport({ files: pick.candidates, suggestedName: pick.folderName });
    } catch (err) {
      console.error("Folder import failed:", err);
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, [t]);

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
          ? {
              sortField: field,
              sortOrder: (filter.sortOrder === "asc" ? "desc" : "asc") as SortOrder,
            }
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
  /** Books under a folder, its subfolders included — what picking it would show. */
  const shelfFolderCount = useCallback(
    (groupId: string) => {
      const wanted = expandFolderIds([groupId], groups);
      return filteredBooks.filter((book) => book.groupId && wanted.has(book.groupId)).length;
    },
    [filteredBooks, groups],
  );

  const pdfCoverRef = useRef<PdfCoverWebViewHandle>(null);
  const [coverJob, setCoverJob] = useState<{ done: number; total: number } | null>(null);
  const coverCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const pdfsNeedingCovers = useMemo(() => coverlessPdfs(books), [books]);

  /**
   * Photograph the first page of every coverless PDF.
   *
   * Started by hand rather than on a timer: it renders pages and reads whole
   * files, which on a phone is the user's battery to spend, not ours.
   */
  const handleGenerateCovers = useCallback(async () => {
    if (coverJob || pdfsNeedingCovers.length === 0) return;
    const renderer = pdfCoverRef.current;
    if (!renderer) return;

    coverCancelRef.current = { cancelled: false };
    setCoverJob({ done: 0, total: pdfsNeedingCovers.length });
    try {
      const platform = getPlatformService();
      const appData = await platform.getAppDataDir();
      const serverUrl = await startFileServer(appData);

      const result = await backfillPdfCovers({
        books: pdfsNeedingCovers,
        fileServerUrl: serverUrl,
        renderCover: (url) => renderer.renderCover(url),
        saveCover: async (bookId, bytes, ext) => {
          const relativePath = `covers/${bookId}.${ext}`;
          const absPath = await platform.joinPath(appData, relativePath);
          await platform.writeFile(absPath, bytes);
          return relativePath;
        },
        updateCoverUrl: async (bookId, coverUrl) => {
          await updateBook(bookId, { meta: { coverUrl } } as Partial<Book>);
        },
        onProgress: (progress) => setCoverJob({ done: progress.done, total: progress.total }),
        signal: coverCancelRef.current,
      });

      await loadBooks();
      Alert.alert(
        t("library.generateCovers", "Generate PDF covers"),
        t("library.generateCoversDone", {
          count: result.done,
          failed: result.failed,
          defaultValue: "{{count}} covers made, {{failed}} could not be read.",
        }),
      );
    } catch (e) {
      Alert.alert(t("common.error", "错误"), e instanceof Error ? e.message : String(e));
    } finally {
      setCoverJob(null);
    }
  }, [coverJob, pdfsNeedingCovers, updateBook, loadBooks, t]);

  const [hashJob, setHashJob] = useState<HashBackfillProgress | null>(null);
  const hashCancelRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const booksNeedingHash = useMemo(() => booksMissingFileHash(books), [books]);

  /**
   * Give the older books a content hash.
   *
   * Import de-duplication matches on SHA-256 and nothing else, so a library
   * imported before hashing existed matches nothing: re-importing the same
   * folder would add a second copy of all 374 books rather than skipping them.
   * Run once, and the next import can tell what it already has.
   *
   * Started by hand, like the covers: it reads every byte of every book on the
   * device, which is the user's battery to spend, not ours. The hashes it
   * writes sync, so the other devices get them without doing the reading.
   */
  const handleBackfillHashes = useCallback(async () => {
    if (hashJob || booksNeedingHash.length === 0) return;

    hashCancelRef.current = { cancelled: false };
    setHashJob({ done: 0, total: booksNeedingHash.length, failed: 0 });
    try {
      const platform = getPlatformService();
      const appData = await platform.getAppDataDir();
      const LegacyFileSystem = await import("expo-file-system/legacy");
      const absolute = (filePath: string) =>
        isLikelyRelativeAppPath(filePath) ? platform.joinPath(appData, filePath) : filePath;

      const result = await backfillFileHashes({
        books: booksNeedingHash,
        knownHashes: existingFileHashes(books),
        statFile: async (filePath) => {
          const info = await LegacyFileSystem.getInfoAsync(await absolute(filePath));
          return info.exists && !info.isDirectory ? (info.size ?? 0) : 0;
        },
        hashFile: async (filePath, size, onProgress) =>
          hashBookFile(await absolute(filePath), size, onProgress),
        saveFileHash: async (bookId, fileHash) => {
          await updateBook(bookId, { fileHash } as Partial<Book>);
        },
        onProgress: setHashJob,
        signal: hashCancelRef.current,
      });

      await loadBooks();
      Alert.alert(
        t("library.identifyBooks", "Identify books"),
        t("library.identifyBooksDone", {
          count: result.done,
          failed: result.failed,
          duplicates: result.duplicates,
          defaultValue:
            "{{count}} books identified, {{failed}} could not be read. {{duplicates}} are a second copy of a book already here.",
        }),
      );
    } catch (e) {
      Alert.alert(t("common.error", "错误"), e instanceof Error ? e.message : String(e));
    } finally {
      setHashJob(null);
    }
  }, [hashJob, booksNeedingHash, books, updateBook, loadBooks, t]);

  const shelfScopeLabel = useMemo(() => {
    if (shelfMode === "all" || shelfGroupIds.length === 0) {
      return t("library.shelfEverything", "全部书籍");
    }
    const names = shelfGroupIds
      .map((id) => groups.find((g) => g.id === id)?.name)
      .filter((name): name is string => !!name);
    if (names.length === 0) return t("library.shelfEverything", "全部书籍");
    if (names.length === 1) return names[0];
    return t("library.shelfFolderCount", { count: names.length });
  }, [shelfMode, shelfGroupIds, groups, t]);

  const isListView = useMemo(() => {
    if (activeGroupId) {
      const prefs = groups.find((g) => g.id === activeGroupId)?.viewPrefs;
      if (prefs?.viewMode) return prefs.viewMode === "list";
    }
    return viewMode === "list";
  }, [activeGroupId, groups, viewMode]);

  const toggleListView = useCallback(() => {
    // Inside a folder there is no shelf — the shelf IS the way to see across
    // folders, so offering it here would just be a grid with extra steps.
    if (activeGroupId) {
      setGroupViewPrefs(activeGroupId, { viewMode: isListView ? "grid" : "list" });
      return;
    }
    const next = viewMode === "grid" ? "list" : viewMode === "list" ? "shelf" : "grid";
    setViewMode(next);
  }, [activeGroupId, isListView, viewMode, setGroupViewPrefs, setViewMode]);

  const isEmpty = gridItems.length === 0;
  const hasBooks = books.length > 0;

  /**
   * What sits above the shelf: the drawing, a line of welcome, and the book
   * you were last in the middle of.
   *
   * It rides inside the list rather than above it so that it scrolls away.
   * A greeting is worth the space the first time you look at the screen and
   * worth none of it once you are hunting for a particular cover, and pinning
   * it would charge you that space on every scroll.
   *
   * It stands down entirely while searching or selecting, when the screen is
   * being used as a tool rather than entered as a room.
   */
  const shelfHeader = useMemo(() => {
    if (selectionMode || filter.search) return null;
    return (
      <View>
        <View style={s.hero}>
          <Image source={cafeIllustration()} style={s.heroArt} resizeMode="contain" />
          <Text style={s.heroTitle}>{t("library.heroTitle", "What will you read next?")}</Text>
          <Text style={s.heroSubtitle}>
            {t("library.heroSubtitle", {
              count: books.length,
              defaultValue: "{{count}} books on your shelf",
            })}
          </Text>
        </View>
        {continueBook ? <ContinueReadingCard book={continueBook} onOpen={handleOpen} /> : null}
      </View>
    );
  }, [selectionMode, filter.search, s, colors, t, books.length, continueBook, handleOpen]);

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

  const selectableBooks = isShelfView ? shelfBooks : visibleBooks;
  const isAllSelected = selectableBooks.length > 0 && selectableBooks.every((book) => selectedBookIds.has(book.id));

  const toggleSelectAll = useCallback(() => {
    if (isAllSelected) {
      setSelectedBookIds(new Set());
    } else {
      setSelectedBookIds(new Set(selectableBooks.map((b) => b.id)));
    }
  }, [selectableBooks, isAllSelected]);

  const handleBatchDelete = useCallback(() => {
    if (selectedBookIds.size === 0) return;
    Alert.alert(
      t("common.confirm", "确认"),
      // Every locale writes this one with a {{count}} placeholder, so the count
      // has to arrive as an option. Passed as a bare default string it printed
      // the placeholder verbatim.
      t("library.batchDeleteConfirm", {
        count: selectedBookIds.size,
        defaultValue: `确定要删除选中的 ${selectedBookIds.size} 本书吗？`,
      }),
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
      Alert.alert(
        group.name,
        undefined,
        [
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
        ],
        // Android's alert shows at most three buttons and silently drops the
        // rest, so the cancel above never rendered here and the dialog had no
        // visible way out. Without this it also refused the back button and a
        // tap outside, which left it genuinely inescapable.
        { cancelable: true },
      );
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
          onPress={() => (selectionMode ? toggleBookSelection(item.book) : handleOpen(item.book))}
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

  const renderShelfItem = useCallback(
    ({ item }: { item: LibraryGridItem }) =>
      item.type === "book" ? (
        <ShelfTile
          book={item.book}
          width={shelfTileWidth}
          onOpen={handleOpen}
          onLongPress={handleShowDetails}
          isSelectionMode={selectionMode}
          isSelected={selectedBookIds.has(item.book.id)}
          onSelect={toggleBookSelection}
        />
      ) : null,
    [shelfTileWidth, handleOpen, handleShowDetails, selectionMode, selectedBookIds, toggleBookSelection],
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

      {importProgress ? (
        <View style={[s.importBanner, { marginHorizontal: 16 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.importBannerTitle} numberOfLines={1}>
              {importProgress.total > 0
                ? `${importProgress.done} / ${importProgress.total}`
                : importProgress.done > 0
                  ? `${importProgress.done} ${t("library.found", "found")}`
                  : t("library.importing", "Importing")}
            </Text>
            <Text style={s.importBannerLabel} numberOfLines={1}>
              {importProgress.label}
            </Text>
          </View>
        </View>
      ) : null}

      <ImportDestinationSheet
        visible={pendingImport !== null}
        bookCount={pendingImport?.files.length ?? 0}
        groups={groups}
        suggestedName={pendingImport?.suggestedName}
        currentGroupId={activeGroupId || undefined}
        onConfirm={runStagedImport}
        onCancel={() => setPendingImport(null)}
      />

      {/* Header */}
      <View style={[s.header, { zIndex: 20 }]}>
        <View style={s.headerInner}>
          {selectionMode ? (
            <View style={s.headerRow}>
              {/* Six actions plus a count is more than a phone header fits. The
                  count must be the part that gives way, or the actions march
                  off the right edge instead of the label truncating. */}
              <View style={s.selectionLead}>
                <TouchableOpacity style={s.headerBtnTight} onPress={exitSelectionMode}>
                  <XIcon size={18} color={colors.foreground} />
                </TouchableOpacity>
                <Text style={s.selectionCount} numberOfLines={1}>
                  {t("library.selectedCount", {
                    count: selectedBookIds.size,
                    defaultValue: `已选 ${selectedBookIds.size} 本`,
                  })}
                </Text>
              </View>
              <View style={s.selectionActions}>
                <TouchableOpacity style={s.headerBtnTight} onPress={toggleSelectAll}>
                  <CheckCheckIcon
                    size={18}
                    color={isAllSelected ? colors.primary : colors.mutedForeground}
                  />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtnTight} onPress={handleBatchTag}>
                  <HashIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtnTight} onPress={handleBatchMoveGroup}>
                  <FolderInputIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                {activeGroupId ? (
                  <TouchableOpacity style={s.headerBtnTight} onPress={handleBatchRemoveFromGroup}>
                    <FolderMinusIcon size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity style={s.headerBtnTight} onPress={handleBatchVectorize}>
                  <DatabaseIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
                <TouchableOpacity style={s.headerBtnTight} onPress={handleBatchDelete}>
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
                source={isDark ? BOOK_DARK_PNG : BOOK_PNG}
                style={{ width: 160, height: 160 }}
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
          {coverJob ? (
            <Text style={s.shelfScopeCount}>
              {t("library.generateCoversProgress", {
                done: coverJob.done,
                total: coverJob.total,
                defaultValue: "Making covers… {{done}}/{{total}}",
              })}
            </Text>
          ) : null}
          {hashJob ? (
            // Reading 1.3 GB of books takes long enough that being stuck with it
            // is a real prospect, so the progress line is also the way out.
            <TouchableOpacity
              onPress={() => {
                hashCancelRef.current.cancelled = true;
              }}
              activeOpacity={0.6}
            >
              <Text style={s.shelfScopeCount}>
                {t("library.identifyBooksProgress", {
                  done: hashJob.done,
                  total: hashJob.total,
                  defaultValue: "Identifying… {{done}}/{{total}} — tap to stop",
                })}
              </Text>
              {hashJob.current ? (
                <Text style={s.shelfScopeCount} numberOfLines={1}>
                  {hashJob.current}
                  {hashJob.currentFraction !== undefined
                    ? ` · ${Math.round(hashJob.currentFraction * 100)}%`
                    : ""}
                </Text>
              ) : null}
            </TouchableOpacity>
          ) : null}
          {isShelfView && isLoaded && hasBooks ? (
            <View style={s.shelfScopeBar}>
              <TouchableOpacity
                style={s.shelfScopeChip}
                onPress={() => setScopeSheetOpen(true)}
                activeOpacity={0.75}
              >
                <LayersIcon size={14} color={colors.mutedForeground} />
                <Text style={s.shelfScopeLabel} numberOfLines={1}>
                  {shelfScopeLabel}
                </Text>
                <ChevronDownIcon size={14} color={colors.mutedForeground} />
              </TouchableOpacity>
              <Text style={s.shelfScopeCount}>
                {t("library.shelfCount", { count: shelfBooks.length })}
              </Text>
            </View>
          ) : null}
          {isLoaded && !isEmpty && (
            <FlatList
              data={gridItems}
              ListHeaderComponent={shelfHeader}
              renderItem={
                isShelfView ? renderShelfItem : isListView ? renderListItem : renderGridItem
              }
              extraData={{ vectorProgress, vectorizingBookId }}
              keyExtractor={(item) =>
                item.type === "group" ? `group-${item.group.id}` : item.book.id
              }
              // FlatList will not change numColumns in place, so the key must
              // change with it or the list keeps its old layout.
              key={`library-${isShelfView ? `shelf-${shelfColumnCount}` : isListView ? "list" : `grid-${columnCount}`}`}
              numColumns={isShelfView ? shelfColumnCount : isListView ? 1 : columnCount}
              columnWrapperStyle={isShelfView ? s.shelfRow : isListView ? undefined : s.gridRow}
              contentContainerStyle={s.gridContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            />
          )}
        </View>
      </View>

      <PdfCoverWebView ref={pdfCoverRef} />

      <ShelfScopeSheet
        visible={scopeSheetOpen}
        groups={groups}
        mode={shelfMode}
        selectedIds={shelfGroupIds}
        bookCountFor={shelfFolderCount}
        totalBooks={filteredBooks.length}
        onShowEverything={showEverything}
        onToggleFolder={toggleShelfFolder}
        onClose={() => setScopeSheetOpen(false)}
      />

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
        viewMode={activeGroupId ? (isListView ? "list" : "grid") : viewMode}
        coverlessPdfCount={pdfsNeedingCovers.length}
        onGenerateCovers={handleGenerateCovers}
        unidentifiedBookCount={booksNeedingHash.length}
        onIdentifyBooks={handleBackfillHashes}
        canCreateFolder={isGroupView}
        canSelectBooks={selectableBooks.length > 0}
        onClose={() => setShowLibraryMenu(false)}
        onSearch={() => (showSearch ? closeSearch() : openSearch())}
        onSelectBooks={() => {
          setSelectionMode(true);
          setSelectedBookIds(new Set());
        }}
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
    shelfGap: number;
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
    selectionLead: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      flex: 1,
      minWidth: 0,
    },
    selectionCount: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      flexShrink: 1,
    },
    selectionActions: { flexDirection: "row", alignItems: "center", gap: 0, flexShrink: 0 },
    headerBtnTight: {
      width: 34,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
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
    importBannerTitle: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
    },
    importBannerLabel: { fontSize: fontSize.xs, color: colors.mutedForeground },
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
    vecBannerTitle: { fontSize: ui(12), color: colors.mutedForeground, marginTop: 2 },
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
    shelfRow: { gap: layout.shelfGap, justifyContent: "flex-start", marginBottom: layout.shelfGap },
    shelfScopeBar: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      paddingBottom: spacing.md,
    },
    shelfScopeChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
      paddingVertical: ui(7),
      borderRadius: radius.full,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    shelfScopeLabel: { fontSize: fontSize.sm, color: colors.foreground },
    shelfScopeCount: { fontSize: fontSize.xs, color: colors.mutedForeground },
    gridContent: { paddingBottom: 24, paddingTop: 4, width: "100%" },
    heroArt: {
      width: "88%",
      height: 168,
    },
    hero: {
      alignItems: "center",
      paddingTop: 12,
      paddingBottom: 4,
      gap: 8,
    },
    heroTitle: {
      color: colors.foreground,
      fontSize: fontSize.xl,
      fontWeight: fontWeight.bold,
      textAlign: "center",
      marginTop: 8,
    },
    heroSubtitle: {
      color: colors.mutedForeground,
      fontSize: fontSize.sm,
      textAlign: "center",
      lineHeight: ui(20),
      marginBottom: 12,
    },
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
