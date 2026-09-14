/**
 * Web pages — the Web tab's saved shelf and recent history.
 *
 * These are in the database rather than device-local storage for one reason:
 * sync carries tables. Anything kept outside the database is, by construction,
 * a thing that cannot follow you to your other device.
 */
import { getDB, getDeviceId, insertTombstone, nextSyncVersion } from "./db-core";

export interface WebPage {
  id: string;
  url: string;
  title: string;
  visitedAt: number;
  saved: boolean;
}

interface WebPageRow {
  id: string;
  url: string;
  title: string;
  visited_at: number;
  saved: number;
}

const toWebPage = (r: WebPageRow): WebPage => ({
  id: r.id,
  url: r.url,
  title: r.title,
  visitedAt: r.visited_at,
  saved: r.saved === 1,
});

/**
 * Trailing slashes are the difference between one page and two copies of it,
 * so identity is decided here rather than at each call site.
 */
export function normalizeUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

export async function getSavedPages(): Promise<WebPage[]> {
  const database = await getDB();
  const rows = await database.select<WebPageRow>(
    "SELECT id, url, title, visited_at, saved FROM web_pages WHERE saved = 1 ORDER BY visited_at DESC",
    [],
  );
  return rows.map(toWebPage);
}

export async function getRecentPages(limit: number): Promise<WebPage[]> {
  const database = await getDB();
  const rows = await database.select<WebPageRow>(
    "SELECT id, url, title, visited_at, saved FROM web_pages ORDER BY visited_at DESC LIMIT ?",
    [limit],
  );
  return rows.map(toWebPage);
}

async function findByUrl(url: string): Promise<WebPageRow | undefined> {
  const database = await getDB();
  const rows = await database.select<WebPageRow>(
    "SELECT id, url, title, visited_at, saved FROM web_pages WHERE url = ? LIMIT 1",
    [normalizeUrl(url)],
  );
  return rows[0];
}

/**
 * Record a visit, keeping whatever `saved` the page already had — visiting a
 * page you saved must not quietly unsave it.
 */
export async function upsertWebPage(page: {
  url: string;
  title: string;
  visitedAt?: number;
  saved?: boolean;
}): Promise<WebPage | null> {
  const url = normalizeUrl(page.url);
  if (!url) return null;

  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "web_pages");
  const now = Date.now();
  const visitedAt = page.visitedAt ?? now;

  const existing = await findByUrl(url);
  const saved = page.saved ?? (existing ? existing.saved === 1 : false);
  const id = existing?.id ?? `web-${now}-${Math.random().toString(36).slice(2, 10)}`;

  await database.execute(
    `INSERT INTO web_pages (id, url, title, visited_at, saved, updated_at, sync_version, last_modified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       url = excluded.url,
       title = excluded.title,
       visited_at = excluded.visited_at,
       saved = excluded.saved,
       updated_at = excluded.updated_at,
       sync_version = excluded.sync_version,
       last_modified_by = excluded.last_modified_by`,
    [id, url, page.title ?? "", visitedAt, saved ? 1 : 0, now, syncVersion, deviceId],
  );

  return { id, url, title: page.title ?? "", visitedAt, saved };
}

/** Returns the page's new saved state, or null if the url was unusable. */
export async function toggleSavedPage(page: {
  url: string;
  title: string;
}): Promise<boolean | null> {
  const existing = await findByUrl(page.url);
  const nextSaved = !(existing?.saved === 1);
  const result = await upsertWebPage({
    url: page.url,
    title: page.title || existing?.title || "",
    visitedAt: existing?.visited_at ?? Date.now(),
    saved: nextSaved,
  });
  return result ? nextSaved : null;
}

/**
 * Unsaving leaves the row in place so it stays in recent history. Removing it
 * outright is what `deleteWebPage` is for, and that needs a tombstone or the
 * other device's copy will simply come back on the next sync.
 */
export async function deleteWebPage(id: string): Promise<void> {
  const database = await getDB();
  await insertTombstone(database, id, "web_pages");
  await database.execute("DELETE FROM web_pages WHERE id = ?", [id]);
}

export async function removeSavedPage(url: string): Promise<void> {
  const existing = await findByUrl(url);
  if (!existing) return;
  await upsertWebPage({
    url: existing.url,
    title: existing.title,
    visitedAt: existing.visited_at,
    saved: false,
  });
}

export async function clearRecentPages(): Promise<void> {
  const database = await getDB();
  const rows = await database.select<{ id: string }>(
    "SELECT id FROM web_pages WHERE saved = 0",
    [],
  );
  for (const row of rows) {
    await deleteWebPage(row.id);
  }
}

/** True when the table has never been written to — the signal to migrate. */
export async function isWebPagesEmpty(): Promise<boolean> {
  const database = await getDB();
  const rows = await database.select<{ n: number }>("SELECT COUNT(*) AS n FROM web_pages", []);
  return (rows[0]?.n ?? 0) === 0;
}
