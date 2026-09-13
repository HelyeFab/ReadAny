/**
 * How a saved page presents itself on the shelf.
 *
 * A URL is the wrong thing to show a reader. It is long, it repeats itself, and
 * the part that identifies the page is buried in the middle. What distinguishes
 * one saved page from another at a glance is the site it came from, so that is
 * what the tile leads with, in a colour drawn from the same seven hues as the
 * folders and reading themes.
 *
 * The colour is derived from the host rather than stored, so the same site is
 * always the same colour on every device, with nothing to keep in sync.
 */
import { FOLDER_COLORS } from "@/lib/library/folder-colors";
import type { FolderColor } from "@/lib/library/folder-colors";

/** "https://www3.nhk.or.jp/news/easy/" -> "nhk.or.jp" */
export function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim());
  const raw = (match ? match[1] : url.trim()).toLowerCase();
  const host = raw.split("@").pop() ?? raw;
  const bare = host.split(":")[0].replace(/^www\d*\./, "");
  return bare || url;
}

/** The letter shown on the tile: the first character of the site's own name. */
export function initialOf(url: string, title?: string): string {
  const source = hostOf(url);
  const first = source.replace(/[^\p{L}\p{N}]/gu, "").charAt(0);
  if (first) return first.toUpperCase();
  const fromTitle = (title || "").trim().charAt(0);
  return fromTitle ? fromTitle.toUpperCase() : "?";
}

/** Same host, same colour, on every device, without storing anything. */
export function colorForUrl(url: string): FolderColor {
  const host = hostOf(url);
  let hash = 0;
  for (let i = 0; i < host.length; i += 1) {
    hash = (hash * 31 + host.charCodeAt(i)) >>> 0;
  }
  return FOLDER_COLORS[hash % FOLDER_COLORS.length];
}

/** "3 days ago" is more use than a date on a list you scan. */
export function relativeTime(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.round(days / 7);
  return weeks < 5 ? `${weeks}w ago` : `${Math.round(days / 30)}mo ago`;
}
