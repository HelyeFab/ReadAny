/**
 * Giving the library's older books a content hash, after the fact.
 *
 * Import de-duplication on the phone asks exactly one question: does any book
 * already hold this file's SHA-256? A book imported before hashing existed
 * answers `undefined`, matches nothing, and the check is silently inert — which
 * is how a second copy of the same 桃太郎 walked in past "skipped 0 duplicates".
 * Hashing those books now is the whole of what makes the next bulk import able
 * to tell a book it already has from one it does not.
 *
 * Deliberately a job you start rather than one that runs by itself: it reads
 * every byte of every book on the device, and on a phone that is the user's
 * battery to spend.
 */
import type { Book } from "@readany/core/types";

/**
 * The books worth hashing: no hash yet, and a file actually on this device.
 *
 * A book whose file lives only on the server would have to be downloaded in
 * full before a single byte could be hashed — 298 MB to learn something the
 * device that uploaded it already knows and will sync over anyway.
 */
export function booksMissingFileHash(books: Book[]): Book[] {
  return books.filter((book) => !book.fileHash && !!book.filePath && book.syncStatus !== "remote");
}

/** Hashes the library already holds, so a fresh one can be recognised as a collision. */
export function existingFileHashes(books: Book[]): Set<string> {
  return new Set(books.map((book) => book.fileHash).filter((hash): hash is string => !!hash));
}

export interface HashBackfillProgress {
  done: number;
  total: number;
  failed: number;
  /** The book being read right now, so a long run has something that moves. */
  current?: string;
  /** How far through that book, 0–1. */
  currentFraction?: number;
}

export interface HashBackfillResult extends HashBackfillProgress {
  /** Books found to share their hash with another — duplicates, now visible. */
  duplicates: number;
}

/**
 * Smallest file first.
 *
 * Two reasons, both about being interrupted. Most of the library is novels of a
 * few megabytes and they are done in the first seconds, so the count climbs
 * immediately instead of sitting at 0 behind a 298 MB textbook; and a run
 * cancelled halfway has then hashed the most books it could, rather than the
 * fewest. The giant ones still get their turn — they are just last.
 */
export function orderBySizeAscending<T extends { size: number }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.size - b.size);
}

/**
 * Report a book's progress only when it has visibly moved.
 *
 * A 4 MiB chunk size means a 300 MB book fires 75 progress callbacks, each one
 * a React state update and, on e-ink, a screen the panel has to redraw. Two
 * percent is finer than the eye reads off a one-line label.
 */
export const PROGRESS_REPORT_STEP = 0.02;

export function shouldReportFraction(previous: number | undefined, next: number): boolean {
  if (previous === undefined) return true;
  if (next >= 1) return true;
  return next - previous >= PROGRESS_REPORT_STEP;
}

export interface BackfillFileHashesOptions {
  books: Book[];
  /** Size of a file in bytes, or 0 if it is not there. */
  statFile: (filePath: string) => Promise<number>;
  /** SHA-256 over the file's bytes, or undefined if it could not be read. */
  hashFile: (
    filePath: string,
    size: number,
    onProgress: (bytesHashed: number, totalBytes: number) => void,
  ) => Promise<string | undefined>;
  saveFileHash: (bookId: string, fileHash: string) => Promise<void>;
  /** Hashes already in the library, so collisions with them are counted too. */
  knownHashes?: Iterable<string>;
  onProgress?: (progress: HashBackfillProgress) => void;
  signal?: { cancelled: boolean };
}

/**
 * Hash each book in turn and write the result to its record.
 *
 * Sequential on purpose: hashing holds a 4 MiB chunk plus an open file handle,
 * and several at once buys nothing on a device whose storage is the bottleneck.
 * Writing through `saveFileHash` per book rather than in one batch at the end
 * means a run that is cancelled, or killed by the OS, keeps everything it has
 * already earned.
 */
export async function backfillFileHashes(
  options: BackfillFileHashesOptions,
): Promise<HashBackfillResult> {
  const { books, statFile, hashFile, saveFileHash, knownHashes, onProgress, signal } = options;

  const progress: HashBackfillProgress = { done: 0, total: books.length, failed: 0 };
  const seen = new Set<string>(knownHashes ?? []);
  let duplicates = 0;

  // Sizes first, for the ordering. A stat is cheap next to a hash, and a file
  // that has gone missing is better found here than one byte into reading it.
  const sized: Array<{ book: Book; size: number }> = [];
  for (const book of books) {
    if (signal?.cancelled) break;
    try {
      const size = await statFile(book.filePath);
      if (size > 0) {
        sized.push({ book, size });
      } else {
        progress.failed += 1;
      }
    } catch (e) {
      progress.failed += 1;
      console.warn(`[FileHash] stat ${book.meta.title}: ${e instanceof Error ? e.message : e}`);
    }
  }

  for (const { book, size } of orderBySizeAscending(sized)) {
    if (signal?.cancelled) break;

    let lastFraction: number | undefined;
    try {
      const hash = await hashFile(book.filePath, size, (bytesHashed, totalBytes) => {
        if (totalBytes <= 0) return;
        const fraction = bytesHashed / totalBytes;
        if (!shouldReportFraction(lastFraction, fraction)) return;
        lastFraction = fraction;
        onProgress?.({ ...progress, current: book.meta.title, currentFraction: fraction });
      });

      // hashBookFile swallows its own errors and returns undefined, because a
      // missing hash is not a reason to fail an import. Here it is the whole
      // point of the run, so it counts as a failure rather than a silent pass.
      if (!hash) throw new Error("file could not be read");

      await saveFileHash(book.id, hash);
      if (seen.has(hash)) duplicates += 1;
      seen.add(hash);
      progress.done += 1;
    } catch (e) {
      // One unreadable book must not end the run — a half-downloaded file, a
      // permission the OS has since taken back, storage unmounted mid-run.
      progress.failed += 1;
      console.warn(`[FileHash] ${book.meta.title}: ${e instanceof Error ? e.message : String(e)}`);
    }

    onProgress?.({ done: progress.done, total: progress.total, failed: progress.failed });
    // Let the UI breathe between books.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  return { ...progress, duplicates };
}
