/**
 * Highlight publication — keeping one living file per book, not a pile of
 * dated snapshots.
 *
 * Exporting highlights (see `highlight-publisher`) answers "write these out
 * once". Reading answers a different question: you highlight four sentences
 * tonight, six more tomorrow, and you want them to accumulate in the same
 * file you already have open in Obsidian. The export path cannot do that on
 * its own, because `buildFiledPath` bakes today's date into the name — the
 * same book computes a different filename tomorrow, so there is no stable
 * "the file for this book" to add to.
 *
 * So this keeps a small registry: which remote file a book's highlights went
 * to, and which of them have already been sent. A second sync then knows both
 * where to write and what not to write again.
 *
 * ⚠️ APPEND, NEVER REWRITE (for the prose formats). The file on the server is
 * something the reader edits by hand — typing their own thoughts under a
 * quote is the entire point of keeping highlights in Obsidian. Re-rendering
 * the document from the database would silently delete that writing. So new
 * highlights are appended as a dated section and the existing bytes are never
 * touched. JSON is the exception: it is a data file, not prose, and a textual
 * append would leave it unparseable, so it is merged by id instead.
 */
import { getPlatformService } from "../services/platform";
import type { Book, Highlight, Note } from "../types";
import type { ExportFormat } from "./annotation-exporter";
import { extensionFor, sanitizeSegment } from "./highlight-filing";

export const HIGHLIGHT_PUBLICATIONS_KEY = "highlight_publications";

/** Where one book's highlights live on the server, and what has been sent. */
export interface PublicationRecord {
  bookId: string;
  /** Absolute remote path of the file being appended to. */
  path: string;
  format: ExportFormat;
  /** Ids of highlights already written out. */
  highlightIds: string[];
  /** Ids of standalone notes already written out. */
  noteIds: string[];
  lastPublishedAt: number;
}

export type PublicationRegistry = Record<string, PublicationRecord>;

/**
 * Annotations that have not been sent yet.
 *
 * Membership is by id rather than by content: editing a note on a highlight
 * that has already been filed does not make it new again. Re-sending it would
 * duplicate the quote in the file, which is worse than the file lagging one
 * edit behind — and the edit is still in the app, where it can be re-exported
 * deliberately.
 */
export function selectUnpublished(
  highlights: Highlight[],
  notes: Note[],
  record: PublicationRecord | null,
): { highlights: Highlight[]; notes: Note[] } {
  if (!record) return { highlights, notes };
  const sentHighlights = new Set(record.highlightIds);
  const sentNotes = new Set(record.noteIds);
  return {
    highlights: highlights.filter((h) => !sentHighlights.has(h.id)),
    notes: notes.filter((n) => !sentNotes.has(n.id)),
  };
}

/**
 * Annotations whose text is not already somewhere in the document.
 *
 * Needed when ADOPTING a file the reader exported by hand before any registry
 * existed: nothing is recorded as sent, but the quotes are plainly already in
 * there, and appending them again would double every highlight in the book.
 * Every format quotes the highlight verbatim (`> ${h.text}`), so a substring
 * test is an honest check rather than a guess. It can only err toward skipping
 * — a highlight of a phrase that happens to appear elsewhere in the file is
 * left out, which is recoverable; a duplicate is what the reader would have to
 * clean up by hand.
 */
export function selectMissingFromDocument(
  highlights: Highlight[],
  notes: Note[],
  document: string,
): { highlights: Highlight[]; notes: Note[] } {
  return {
    highlights: highlights.filter((h) => h.text.trim() && !document.includes(h.text.trim())),
    notes: notes.filter((n) => n.content.trim() && !document.includes(n.content.trim())),
  };
}

function formatDay(now: Date): string {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function groupByChapter(highlights: Highlight[]): Map<string, Highlight[]> {
  const grouped = new Map<string, Highlight[]>();
  for (const h of highlights) {
    const chapter = h.chapterTitle || "Unknown Chapter";
    const bucket = grouped.get(chapter);
    if (bucket) bucket.push(h);
    else grouped.set(chapter, [h]);
  }
  return grouped;
}

/**
 * The block of Markdown to append for a batch of new annotations.
 *
 * Heading levels are chosen to slot under what `AnnotationExporter` already
 * wrote: its chapters are `##` in markdown and `###` in obsidian, so the
 * dated wrapper sits one level above the chapters it contains in each.
 */
export function renderMarkdownIncrement(params: {
  highlights: Highlight[];
  notes: Note[];
  format: Exclude<ExportFormat, "json">;
  now: Date;
}): string {
  const { highlights, notes, format, now } = params;
  const obsidian = format === "obsidian";
  const lines: string[] = ["", "---", "", `## Added ${formatDay(now)}`, ""];

  for (const [chapter, chapterHighlights] of groupByChapter(highlights)) {
    lines.push(`### ${chapter}`, "");
    for (const h of chapterHighlights) {
      if (obsidian) lines.push("> [!quote] Highlight");
      lines.push(`> ${h.text}`, "");
      if (h.note) lines.push(`**Note:** ${h.note}`, "");
    }
  }

  const standalone = notes.filter((n) => !n.highlightId);
  if (standalone.length > 0) {
    lines.push("### Notes", "");
    for (const note of standalone) {
      lines.push(`#### ${note.title}`, "");
      if (note.chapterTitle) lines.push(`*${note.chapterTitle}*`, "");
      lines.push(note.content, "");
      if (obsidian && note.tags.length > 0) {
        lines.push(`Tags: ${note.tags.map((t) => `#${t}`).join(" ")}`, "");
      }
    }
  }

  return lines.join("\n");
}

interface JsonDocument {
  highlights?: Array<{ id?: string }>;
  notes?: Array<{ id?: string }>;
  [key: string]: unknown;
}

/**
 * Merge new annotations into an existing JSON export, keyed by id.
 *
 * Unlike the prose formats this rewrites the document — appending text to
 * JSON would produce a file nothing can parse. Entries already present are
 * left exactly as they are, so the merge is additive in effect too.
 */
export function mergeJsonIncrement(params: {
  existing: string;
  book: Book;
  highlights: Highlight[];
  notes: Note[];
  now: Date;
}): string {
  const { existing, book, highlights, notes, now } = params;

  let doc: JsonDocument;
  try {
    const parsed = JSON.parse(existing) as unknown;
    doc = parsed && typeof parsed === "object" ? (parsed as JsonDocument) : {};
  } catch {
    // A corrupt or hand-mangled file is not something to overwrite blindly;
    // the caller treats a throw as "fall back to writing a fresh file".
    throw new Error("The existing JSON export could not be parsed");
  }

  const existingHighlights = Array.isArray(doc.highlights) ? doc.highlights : [];
  const existingNotes = Array.isArray(doc.notes) ? doc.notes : [];
  const haveHighlight = new Set(existingHighlights.map((h) => h?.id).filter(Boolean));
  const haveNote = new Set(existingNotes.map((n) => n?.id).filter(Boolean));

  return JSON.stringify(
    {
      ...doc,
      book: doc.book ?? {
        id: book.id,
        title: book.meta.title,
        author: book.meta.author,
        language: book.meta.language,
      },
      exportedAt: now.toISOString(),
      highlights: [
        ...existingHighlights,
        ...highlights
          .filter((h) => !haveHighlight.has(h.id))
          .map((h) => ({
            id: h.id,
            text: h.text,
            color: h.color,
            note: h.note,
            chapter: h.chapterTitle,
            createdAt: new Date(h.createdAt).toISOString(),
          })),
      ],
      notes: [
        ...existingNotes,
        ...notes
          .filter((n) => !haveNote.has(n.id))
          .map((n) => ({
            id: n.id,
            title: n.title,
            content: n.content,
            chapter: n.chapterTitle,
            tags: n.tags,
            createdAt: new Date(n.createdAt).toISOString(),
          })),
      ],
    },
    null,
    2,
  );
}

/**
 * Whether a file already on the server looks like this book's export.
 *
 * Used to adopt folders the reader made before any of this existed, so a
 * first sync adds to the file they already have rather than dropping a second
 * one beside it. Deliberately conservative: the book's sanitized title has to
 * appear in the filename, which is true of every name the filing templates
 * produce (they all carry `{title}`) and unlikely to be true by accident.
 */
export function isAdoptableExport(
  filename: string,
  bookTitle: string,
  format: ExportFormat,
): boolean {
  const ext = `.${extensionFor(format)}`;
  if (!filename.toLowerCase().endsWith(ext)) return false;
  const title = sanitizeSegment(bookTitle).toLowerCase();
  if (!title) return false;
  return filename.toLowerCase().includes(title);
}

/**
 * Pick which of several candidate files to adopt: the one most recently
 * written, because that is the one the reader has been adding to.
 */
export function pickAdoptionCandidate<T extends { name: string; lastModified?: string }>(
  candidates: T[],
): T | null {
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const at = a.lastModified ? Date.parse(a.lastModified) : 0;
    const bt = b.lastModified ? Date.parse(b.lastModified) : 0;
    if (Number.isNaN(at) || Number.isNaN(bt) || at === bt) return a.name.localeCompare(b.name);
    return bt - at;
  })[0];
}

// --- Registry storage ---

export async function loadPublicationRegistry(): Promise<PublicationRegistry> {
  try {
    const raw = await getPlatformService().kvGetItem(HIGHLIGHT_PUBLICATIONS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as PublicationRegistry;
  } catch (error) {
    console.warn("[Publish] Ignoring unreadable publication registry:", error);
    return {};
  }
}

export async function getPublication(bookId: string): Promise<PublicationRecord | null> {
  const registry = await loadPublicationRegistry();
  return registry[bookId] ?? null;
}

export async function savePublication(record: PublicationRecord): Promise<void> {
  try {
    const registry = await loadPublicationRegistry();
    registry[record.bookId] = record;
    await getPlatformService().kvSetItem(HIGHLIGHT_PUBLICATIONS_KEY, JSON.stringify(registry));
  } catch (error) {
    // Losing the record costs a duplicate section next time, not the export.
    console.warn("[Publish] Failed to remember where highlights were published:", error);
  }
}

export async function forgetPublication(bookId: string): Promise<void> {
  try {
    const registry = await loadPublicationRegistry();
    if (!(bookId in registry)) return;
    delete registry[bookId];
    await getPlatformService().kvSetItem(HIGHLIGHT_PUBLICATIONS_KEY, JSON.stringify(registry));
  } catch (error) {
    console.warn("[Publish] Failed to forget a publication record:", error);
  }
}

/** The record that results from sending `highlights`/`notes` to `path`. */
export function recordAfterPublish(params: {
  bookId: string;
  path: string;
  format: ExportFormat;
  previous: PublicationRecord | null;
  highlights: Highlight[];
  notes: Note[];
  now: Date;
}): PublicationRecord {
  const { bookId, path, format, previous, highlights, notes, now } = params;
  return {
    bookId,
    path,
    format,
    highlightIds: [...new Set([...(previous?.highlightIds ?? []), ...highlights.map((h) => h.id)])],
    noteIds: [...new Set([...(previous?.noteIds ?? []), ...notes.map((n) => n.id)])],
    lastPublishedAt: now.getTime(),
  };
}
