/**
 * Giving the coverless PDFs a cover, after the fact.
 *
 * Books imported before this existed have no cover and never will on their own,
 * so the shelf needs a way to go back over them. Deliberately a job you start
 * rather than something that runs by itself: it renders pages, reads whole
 * files, and on a phone that is a thing the user should be choosing to spend.
 */
import type { Book } from "@readany/core/types";

/** A data URL is the renderer's output; this is the bytes behind it. */
export function decodeDataUrl(dataUrl: string): { bytes: Uint8Array; ext: string } | null {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/);
  if (!match) return null;
  const ext = match[1] === "png" ? "png" : "jpg";
  const binary = globalThis.atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { bytes, ext };
}

/**
 * The PDFs worth trying: no cover, and a file actually on this device.
 *
 * A book whose file lives only on the server would have to be downloaded in
 * full to photograph its first page, which is not a trade worth making without
 * being asked.
 */
export function coverlessPdfs(books: Book[]): Book[] {
  return books.filter(
    (book) =>
      book.format === "pdf" &&
      !book.meta.coverUrl &&
      !!book.filePath &&
      book.syncStatus !== "remote",
  );
}

export interface BackfillProgress {
  done: number;
  total: number;
  failed: number;
}

/**
 * Render and store a cover for each book, one at a time.
 *
 * Sequential on purpose: each render holds a decoded page in the WebView, and
 * several at once is how a phone runs out of memory. `onProgress` is called
 * after every book so a long job can be watched — and stopped, via `signal`.
 */
export async function backfillPdfCovers(options: {
  books: Book[];
  fileServerUrl: string;
  renderCover: (url: string) => Promise<string>;
  saveCover: (bookId: string, bytes: Uint8Array, ext: string) => Promise<string>;
  updateCoverUrl: (bookId: string, coverUrl: string) => Promise<void>;
  onProgress?: (progress: BackfillProgress) => void;
  signal?: { cancelled: boolean };
}): Promise<BackfillProgress> {
  const { books, fileServerUrl, renderCover, saveCover, updateCoverUrl, onProgress, signal } =
    options;
  const progress: BackfillProgress = { done: 0, total: books.length, failed: 0 };

  for (const book of books) {
    if (signal?.cancelled) break;
    try {
      const encoded = book.filePath
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
      const dataUrl = await renderCover(`${fileServerUrl.replace(/\/$/, "")}/${encoded}`);
      const decoded = decodeDataUrl(dataUrl);
      if (!decoded) throw new Error("Renderer returned something that is not an image");

      const relativePath = await saveCover(book.id, decoded.bytes, decoded.ext);
      await updateCoverUrl(book.id, relativePath);
      progress.done += 1;
    } catch (e) {
      // One unreadable PDF must not end the run — encrypted files, damaged
      // downloads and scanner output all fail here and the rest are fine.
      progress.failed += 1;
      console.warn(`[PdfCover] ${book.meta.title}: ${e instanceof Error ? e.message : String(e)}`);
    }
    onProgress?.({ ...progress });
    // Let the UI breathe between renders.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return progress;
}
