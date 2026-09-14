/**
 * Highlight publisher — send an export to the WebDAV server the app is
 * already signed in to (a Nextcloud, a Synology, anything that speaks DAV).
 *
 * Highlights are the part of reading worth keeping, and a share sheet keeps
 * them only as well as whatever app catches the file. Writing them to the
 * same server the library already syncs with means they land somewhere that
 * is backed up, reachable from every device, and organised by the filing
 * rules rather than by whatever the share target felt like doing.
 *
 * The credentials are not asked for again: sync already stores a URL, a
 * username and a password, and this borrows them.
 */
import { getPlatformService } from "../services/platform";
import { SYNC_BACKEND_CONFIG_KEYS, SYNC_SECRET_KEYS } from "../sync/sync-backend";
import { WebDavClient } from "../sync/webdav-client";
import type { Book, Highlight, Note } from "../types";
import { AnnotationExporter, type ExportFormat } from "./annotation-exporter";
import {
  type FiledPath,
  type FilingContext,
  type FilingOptions,
  buildFiledPath,
  mimeTypeFor,
  resolveCollision,
} from "./highlight-filing";
import {
  getPublication,
  isAdoptableExport,
  mergeJsonIncrement,
  pickAdoptionCandidate,
  recordAfterPublish,
  renderMarkdownIncrement,
  savePublication,
  selectMissingFromDocument,
  selectUnpublished,
} from "./highlight-publication";

export interface WebDavCredentials {
  url: string;
  username: string;
  password: string;
  allowInsecure?: boolean;
}

export type PublishConflict = "keepBoth" | "overwrite";

export interface PublishRequest {
  content: string;
  format: ExportFormat;
  filing: FilingOptions;
  context: FilingContext;
  conflict?: PublishConflict;
}

export interface PublishResult {
  path: string;
  /** True when a name collision pushed the file to "… (2)". */
  renamed: boolean;
}

/**
 * The WebDAV account sync is configured with, or null when the user has not
 * set one up. Read straight from storage rather than the sync store so this
 * works the same on desktop and mobile, and outside React.
 */
export async function loadSyncWebDavCredentials(): Promise<WebDavCredentials | null> {
  const platform = getPlatformService();
  const [rawConfig, password] = await Promise.all([
    platform.kvGetItem(SYNC_BACKEND_CONFIG_KEYS.webdav),
    platform.kvGetItem(SYNC_SECRET_KEYS.webdav),
  ]);
  if (!rawConfig || !password) return null;
  try {
    const config = JSON.parse(rawConfig) as {
      url?: string;
      username?: string;
      allowInsecure?: boolean;
    };
    if (!config.url || !config.username) return null;
    return {
      url: config.url,
      username: config.username,
      password,
      allowInsecure: config.allowInsecure,
    };
  } catch {
    return null;
  }
}

/** Write one export to the server, creating the folders it needs. */
export async function publishHighlightsToWebDav(
  credentials: WebDavCredentials,
  request: PublishRequest,
): Promise<PublishResult> {
  const client = new WebDavClient(
    credentials.url,
    credentials.username,
    credentials.password,
    credentials.allowInsecure,
  );

  const filed = buildFiledPath(request.filing, request.context);
  // ensureDirectory walks the tree creating each level, so a brand-new
  // "/Highlights/2026/09/Some Book" costs one call and no bookkeeping here.
  if (filed.dir !== "/") await client.ensureDirectory(filed.dir);

  let target: FiledPath = filed;
  if ((request.conflict ?? "keepBoth") === "keepBoth") {
    target = await resolveCollision(filed, (path) => client.exists(path));
  }

  await client.put(target.path, request.content, mimeTypeFor(request.format));
  return { path: target.path, renamed: target.path !== filed.path };
}

// --- Incremental publishing -------------------------------------------------

/**
 * Sync one book's annotations to the server, adding only what is new.
 *
 * Three cases, in the order they are tried:
 *
 *  1. **Known file** — the registry says where this book was filed and the
 *     file is still there. Append the annotations that have not been sent.
 *  2. **Adoptable file** — nothing is recorded, but the folder the filing
 *     rules point at already holds an export of this book (made by hand
 *     through the export sheet, most likely). Adopt it rather than dropping a
 *     second file beside it, and append only the quotes it does not already
 *     contain.
 *  3. **Nothing yet** — write a fresh export through the normal filing path.
 *
 * The distinction matters because the reader's habit is "tap sync, keep
 * reading". Any outcome that quietly makes a second file, or repeats quotes
 * already on the page, turns that habit into cleanup work.
 */
export type SyncAnnotationsOutcome =
  | "created"
  | "appended"
  | "adopted"
  | "upToDate"
  | /** Nothing to add to: the caller should ask where these should go. */ "needsDestination";

export interface SyncAnnotationsRequest {
  book: Book;
  highlights: Highlight[];
  notes: Note[];
  filing: FilingOptions;
  /** Injected so callers and tests control the clock. */
  now?: Date;
  /**
   * Stop and report `needsDestination` rather than silently creating a new
   * file.
   *
   * ⚠️ Whether to ask is a question about the SERVER, not about the registry.
   * Remembering where a book was filed is not the same as that file still
   * being there: delete it from Nextcloud and the record still names it, and
   * a caller that decides by looking only at the record will go quiet at
   * exactly the moment it should have asked. So the decision is made here,
   * after the existence checks, and handed back.
   */
  confirmBeforeCreating?: boolean;
}

export interface SyncAnnotationsResult {
  outcome: SyncAnnotationsOutcome;
  path: string;
  /** How many annotations this sync actually wrote. */
  added: number;
}

/** Directory the filing rules put this book in, without touching the server. */
function filedPathFor(filing: FilingOptions, book: Book, now: Date): FiledPath {
  return buildFiledPath(filing, {
    title: book.meta.title,
    author: book.meta.author,
    now,
  });
}

export async function syncBookAnnotationsToWebDav(
  credentials: WebDavCredentials,
  request: SyncAnnotationsRequest,
): Promise<SyncAnnotationsResult> {
  const { book, highlights, notes, filing } = request;
  const now = request.now ?? new Date();
  const format = filing.format;

  if (format === "notion") {
    // Notion export is clipboard-shaped by design; there is no file to append to.
    throw new Error(
      "The Notion format is copied to the clipboard and cannot be synced to a server",
    );
  }

  const client = new WebDavClient(
    credentials.url,
    credentials.username,
    credentials.password,
    credentials.allowInsecure,
  );
  const exporter = new AnnotationExporter();
  const record = await getPublication(book.id);

  // --- 1. A file we already know about -------------------------------------
  if (record && record.format === format && (await client.exists(record.path))) {
    const pending = selectUnpublished(highlights, notes, record);
    if (pending.highlights.length === 0 && pending.notes.length === 0) {
      return { outcome: "upToDate", path: record.path, added: 0 };
    }
    const written = await appendTo(client, exporter, {
      path: record.path,
      book,
      format,
      highlights: pending.highlights,
      notes: pending.notes,
      now,
      // The registry is the authority here: it knows what went out, so a
      // second text scan would only risk dropping a legitimately repeated quote.
      dedupeAgainstDocument: false,
    });
    await savePublication(
      recordAfterPublish({
        bookId: book.id,
        path: written.path,
        format,
        previous: record,
        highlights: pending.highlights,
        notes: pending.notes,
        now,
      }),
    );
    return { outcome: "appended", path: written.path, added: written.added };
  }

  // --- 2. A file already on the server we can adopt -------------------------
  const filed = filedPathFor(filing, book, now);
  const adopted = await findAdoptableExport(client, filed.dir, book.meta.title, format);
  if (adopted) {
    const written = await appendTo(client, exporter, {
      path: adopted,
      book,
      format,
      highlights,
      notes,
      now,
      // Nothing is recorded, but the file plainly holds some of these already.
      dedupeAgainstDocument: true,
    });
    await savePublication(
      recordAfterPublish({
        bookId: book.id,
        path: written.path,
        format,
        previous: null,
        highlights,
        notes,
        now,
      }),
    );
    return {
      outcome: written.added > 0 ? "adopted" : "upToDate",
      path: written.path,
      added: written.added,
    };
  }

  // --- 3. Nothing yet: a fresh export --------------------------------------
  // Nothing on the server holds these highlights, whatever the registry
  // remembers. Creating a file is a choice about where things live, so it is
  // the caller's to make.
  if (request.confirmBeforeCreating) {
    return { outcome: "needsDestination", path: filed.path, added: 0 };
  }

  const content = exporter.export(highlights, notes, book, { format });
  const result = await publishHighlightsToWebDav(credentials, {
    content,
    format,
    filing,
    context: { title: book.meta.title, author: book.meta.author, now },
    conflict: "keepBoth",
  });
  await savePublication(
    recordAfterPublish({
      bookId: book.id,
      path: result.path,
      format,
      previous: null,
      highlights,
      notes,
      now,
    }),
  );
  return {
    outcome: "created",
    path: result.path,
    added: highlights.length + notes.filter((n) => !n.highlightId).length,
  };
}

/**
 * Append a batch to an existing remote document.
 *
 * Reports the path it actually wrote to, which is not always the one it was
 * given: a JSON file that will not parse gets a clean sibling rather than
 * being overwritten, and the registry has to point at the sibling or every
 * later sync would walk back into the same broken file.
 */
async function appendTo(
  client: WebDavClient,
  exporter: AnnotationExporter,
  params: {
    path: string;
    book: Book;
    format: Exclude<ExportFormat, "notion">;
    highlights: Highlight[];
    notes: Note[];
    now: Date;
    dedupeAgainstDocument: boolean;
  },
): Promise<{ added: number; path: string }> {
  const { path, book, format, now, dedupeAgainstDocument } = params;
  const existing = await client.getText(path);

  let { highlights, notes } = params;
  if (dedupeAgainstDocument) {
    const missing = selectMissingFromDocument(highlights, notes, existing);
    highlights = missing.highlights;
    notes = missing.notes;
  }

  const standaloneNotes = notes.filter((n) => !n.highlightId);
  const added = highlights.length + standaloneNotes.length;
  if (added === 0) return { added: 0, path };

  let content: string;
  let target = path;
  if (format === "json") {
    try {
      content = mergeJsonIncrement({ existing, book, highlights, notes, now });
    } catch {
      // An unparseable file is not ours to repair; write a clean one beside it
      // rather than destroying whatever is in there.
      content = exporter.export(highlights, notes, book, { format });
      target = `${path}.new`;
    }
  } else {
    content = existing + renderMarkdownIncrement({ highlights, notes, format, now });
  }

  await client.put(target, content, mimeTypeFor(format));
  return { added, path: target };
}

/** An existing export of this book in `dir`, if there is one. */
async function findAdoptableExport(
  client: WebDavClient,
  dir: string,
  bookTitle: string,
  format: ExportFormat,
): Promise<string | null> {
  // propfind, not safeReadDir: listing a folder should never create it.
  let entries: Awaited<ReturnType<WebDavClient["propfind"]>>;
  try {
    entries = await client.propfind(dir);
  } catch {
    return null;
  }
  const candidates = entries.filter(
    (entry) => !entry.isCollection && isAdoptableExport(entry.name, bookTitle, format),
  );
  const pick = pickAdoptionCandidate(candidates);
  if (!pick) return null;
  return dir === "/" ? `/${pick.name}` : `${dir}/${pick.name}`;
}
