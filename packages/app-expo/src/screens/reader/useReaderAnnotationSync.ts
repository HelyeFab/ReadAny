/**
 * Syncing the open book's highlights from the reader.
 *
 * The sync button in the reader used to mean one thing: push the database to
 * the server so the other devices catch up. But the reason to look at that
 * button mid-book is almost always the other kind of syncing — "I have marked
 * six good sentences, put them somewhere I can read them." That destination
 * already exists (the export sheet files highlights onto the same WebDAV
 * server), it just had to be reached through the Notes tab, two screens away
 * from the book it is about.
 *
 * So the same tap now also files the open book's new annotations. The first
 * time for a given book it asks where they should go — folder, scheme, format
 * — because that is a decision worth making once. After that it is silent:
 * tap, the new highlights are appended to the file that already exists, keep
 * reading.
 */
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert } from "react-native";

import type { ExportDestination } from "@/components/notes/HighlightExportSheet";
import { AnnotationExporter } from "@readany/core/export";
import {
  DEFAULT_EXPORT_PREFS,
  type HighlightExportPrefs,
  loadHighlightExportPrefs,
  saveHighlightExportPrefs,
} from "@readany/core/export/highlight-export-prefs";
import { getPublication } from "@readany/core/export/highlight-publication";
import {
  type WebDavCredentials,
  loadSyncWebDavCredentials,
  syncBookAnnotationsToWebDav,
} from "@readany/core/export/highlight-publisher";
import type { Book, Highlight, Note } from "@readany/core/types";

interface Params {
  book: Book | undefined;
  highlights: Highlight[];
  notes: Note[];
}

export function useReaderAnnotationSync({ book, highlights, notes }: Params) {
  const { t } = useTranslation();

  const [sheetVisible, setSheetVisible] = useState(false);
  const [prefs, setPrefs] = useState<HighlightExportPrefs>(DEFAULT_EXPORT_PREFS);
  const [creds, setCreds] = useState<WebDavCredentials | null>(null);
  const [busy, setBusy] = useState(false);

  const webDavLabel = useMemo(() => {
    if (!creds?.url) return undefined;
    try {
      return new URL(creds.url).host;
    } catch {
      return creds.url;
    }
  }, [creds?.url]);

  const hasAnnotations = highlights.length > 0 || notes.some((n) => !n.highlightId);

  /** Send this book's new annotations to the server under `filing`. */
  const run = useCallback(
    async (credentials: WebDavCredentials, filing: HighlightExportPrefs) => {
      if (!book) return;
      setBusy(true);
      try {
        const result = await syncBookAnnotationsToWebDav(credentials, {
          book,
          highlights,
          notes,
          filing: {
            baseFolder: filing.baseFolder,
            scheme: filing.scheme,
            filenameTemplate: filing.filenameTemplate,
            format: filing.format,
          },
        });
        setSheetVisible(false);

        if (result.outcome === "upToDate") {
          Alert.alert(
            t("reader.syncHighlightsTitle", "Highlights"),
            t("reader.highlightsUpToDate", "Everything is already saved to the server."),
          );
          return;
        }
        Alert.alert(
          t("reader.syncHighlightsTitle", "Highlights"),
          t("reader.highlightsSynced", {
            count: result.added,
            path: result.path,
            defaultValue: `Added ${result.added} to ${result.path}`,
          }),
        );
      } catch (error) {
        console.error("[ReaderSync] Publishing highlights failed:", error);
        Alert.alert(
          t("common.error", "错误"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setBusy(false);
      }
    },
    [book, highlights, notes, t],
  );

  /**
   * The sync button's tap. Decides between asking where things go and just
   * getting on with it, so the common case stays a single tap.
   */
  const syncAnnotations = useCallback(async () => {
    if (!book || !hasAnnotations) return;

    const [stored, credentials] = await Promise.all([
      loadHighlightExportPrefs(),
      loadSyncWebDavCredentials(),
    ]);
    setCreds(credentials);

    // In the reader the scope is never in question — it is this book. The
    // stored preference belongs to the Notes screen and is left alone.
    const bookPrefs: HighlightExportPrefs = { ...stored, scope: "book" };
    setPrefs(bookPrefs);

    if (!credentials) {
      Alert.alert(
        t("common.error", "错误"),
        t(
          "notes.webDavNotConfigured",
          "Connect a WebDAV server in Settings → Sync to save highlights there.",
        ),
      );
      return;
    }

    // Notion is a clipboard format with no file behind it, so it can never be
    // the thing a silent tap writes to. Ask instead.
    const published = await getPublication(book.id);
    if (!published || bookPrefs.format === "notion") {
      setSheetVisible(true);
      return;
    }

    await run(credentials, bookPrefs);
  }, [book, hasAnnotations, run, t]);

  /** The sheet's confirm button, for the first sync of a book. */
  const onExport = useCallback(
    async (destination: ExportDestination) => {
      if (!book) return;
      await saveHighlightExportPrefs(prefs);

      if (prefs.format === "notion") {
        const content = new AnnotationExporter().export(highlights, notes, book, {
          format: "notion",
        });
        await new AnnotationExporter().copyToClipboard(content);
        setSheetVisible(false);
        Alert.alert(t("common.success", "成功"), t("notes.copiedToClipboard", "已复制到剪贴板"));
        return;
      }

      if (destination === "share") {
        const exporter = new AnnotationExporter();
        const content = exporter.export(highlights, notes, book, { format: prefs.format });
        await exporter.downloadAsFile(
          content,
          `${book.meta.title}.${prefs.format === "json" ? "json" : "md"}`,
          prefs.format,
        );
        setSheetVisible(false);
        return;
      }

      if (!creds) return;
      await run(creds, prefs);
    },
    [book, creds, highlights, notes, prefs, run, t],
  );

  return {
    /** Whether the button should offer to do anything at all. */
    hasAnnotations,
    busy,
    syncAnnotations,
    sheetProps: {
      visible: sheetVisible,
      bookTitle: book?.meta.title ?? "",
      bookAuthor: book?.meta.author,
      bookCount: 1,
      prefs,
      webDavConfigured: !!creds,
      webDavLabel,
      busy,
      onChange: setPrefs,
      onExport: (destination: ExportDestination) => void onExport(destination),
      onCancel: () => setSheetVisible(false),
    },
  };
}
