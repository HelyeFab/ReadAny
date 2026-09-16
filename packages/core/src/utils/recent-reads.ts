/**
 * What the shelf offers you back, and what you have told it to stop offering.
 *
 * A library screen is rarely a browse. Most visits are the middle of
 * something, and the useful question is not "what do I own" but "what was I
 * in". This picks the handful of books that answer that, most recent first.
 *
 * The second half is the part that makes the first half trustworthy. A list
 * the reader cannot correct is a list they learn to ignore: a book opened
 * once by accident, or an import that stamped `lastOpenedAt` on arrival, sits
 * at the front for weeks and the row slowly becomes furniture. So each entry
 * can be dismissed, and a dismissal is stored as the MOMENT it happened
 * rather than as a flag. Open the book again and its `lastOpenedAt` moves past
 * that moment, so it simply comes back — no un-dismiss gesture to find, and no
 * way to permanently exile a book you are still reading.
 */
import { getPlatformService } from "../services/platform";
import type { Book } from "../types/book";

export const RECENT_READS_DISMISSED_KEY = "recent_reads_dismissed";
export const RECENT_READS_COLLAPSED_KEY = "recent_reads_collapsed";

/** Books past this are finished; handing them back is noise, not a service. */
const FINISHED_THRESHOLD = 0.995;

/** How many books the strip will hold, beyond the one in the hero card. */
export const RECENT_READS_LIMIT = 8;

/** bookId → when it was dismissed, in epoch ms. */
export type DismissedRecents = Record<string, number>;

export interface SelectRecentReadsOptions {
  books: Book[];
  dismissed: DismissedRecents;
  /** Total entries to return, hero card included. */
  limit?: number;
}

/**
 * Is this book a candidate at all, before recency is considered?
 *
 * Deliberately excludes books that are finished, deleted, still downloading,
 * or never opened. A book still coming down from the server cannot be opened,
 * so putting it one tap away is a promise the card cannot keep.
 */
function isResumable(book: Book): boolean {
  if (book.deletedAt) return false;
  if (!book.lastOpenedAt) return false;
  if (book.progress >= FINISHED_THRESHOLD) return false;
  if (book.syncStatus === "downloading") return false;
  return true;
}

/**
 * The books to offer back, most recently opened first.
 *
 * Ordering is by `lastOpenedAt` alone, with one correction: an import stamps
 * `lastOpenedAt` too, so a book that arrived on the shelf a minute ago would
 * otherwise shove aside the one actually being read. Anything started ranks
 * above anything untouched, and untouched books fill the remaining slots.
 */
export function selectRecentReads({
  books,
  dismissed,
  limit = RECENT_READS_LIMIT + 1,
}: SelectRecentReadsOptions): Book[] {
  if (limit <= 0) return [];

  const started: Book[] = [];
  const untouched: Book[] = [];

  for (const book of books) {
    if (!isResumable(book)) continue;
    // A dismissal only silences the book until it is opened again.
    const dismissedAt = dismissed[book.id];
    if (dismissedAt !== undefined && (book.lastOpenedAt ?? 0) <= dismissedAt) continue;
    (book.progress > 0 ? started : untouched).push(book);
  }

  const byRecency = (a: Book, b: Book) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0);
  started.sort(byRecency);
  untouched.sort(byRecency);

  return [...started, ...untouched].slice(0, limit);
}

/** Accept only well-formed entries; a corrupt file must not hide every book. */
function coerce(raw: unknown): DismissedRecents {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const result: DismissedRecents = {};
  for (const [id, at] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === "string" && id && typeof at === "number" && Number.isFinite(at)) {
      result[id] = at;
    }
  }
  return result;
}

export async function loadDismissedRecents(): Promise<DismissedRecents> {
  try {
    const raw = await getPlatformService().kvGetItem(RECENT_READS_DISMISSED_KEY);
    if (!raw) return {};
    return coerce(JSON.parse(raw));
  } catch (error) {
    console.warn("[Library] Ignoring unreadable recent-reads dismissals:", error);
    return {};
  }
}

export async function saveDismissedRecents(dismissed: DismissedRecents): Promise<void> {
  try {
    await getPlatformService().kvSetItem(
      RECENT_READS_DISMISSED_KEY,
      JSON.stringify(coerce(dismissed)),
    );
  } catch (error) {
    // Forgetting a dismissal costs one more tap; it is not worth failing over.
    console.warn("[Library] Failed to remember recent-reads dismissals:", error);
  }
}

/**
 * Drop entries for books that can no longer appear.
 *
 * Without this the record grows forever: delete a book and its dismissal
 * outlives it. Called when the dismissals are saved, so the housekeeping
 * rides along with a write that was happening anyway.
 */
export function pruneDismissedRecents(
  dismissed: DismissedRecents,
  books: Book[],
): DismissedRecents {
  const live = new Map(books.map((book) => [book.id, book]));
  const result: DismissedRecents = {};
  for (const [id, at] of Object.entries(dismissed)) {
    const book = live.get(id);
    if (!book || book.deletedAt) continue;
    // Already back in the list on its own merits — the entry has done its job.
    if ((book.lastOpenedAt ?? 0) > at) continue;
    result[id] = at;
  }
  return result;
}

/**
 * Whether the row is folded away.
 *
 * Kept on disk rather than in component state because the answer is a
 * standing preference, not a detail of this visit: someone who does not want
 * the row does not want it tomorrow either, and re-folding it on every launch
 * would make the control feel like it had not worked.
 */
export async function loadRecentReadsCollapsed(): Promise<boolean> {
  try {
    return (await getPlatformService().kvGetItem(RECENT_READS_COLLAPSED_KEY)) === "1";
  } catch (error) {
    console.warn("[Library] Ignoring unreadable recent-reads fold state:", error);
    return false;
  }
}

export async function saveRecentReadsCollapsed(collapsed: boolean): Promise<void> {
  try {
    await getPlatformService().kvSetItem(RECENT_READS_COLLAPSED_KEY, collapsed ? "1" : "0");
  } catch (error) {
    console.warn("[Library] Failed to remember recent-reads fold state:", error);
  }
}
