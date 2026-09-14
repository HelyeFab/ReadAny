/**
 * The Web tab's shelf and history.
 *
 * These lists used to live only in this store's persisted blob, which is why
 * they were the one part of the app that could never reach another device:
 * sync carries database tables, and they were not one. They are now rows in
 * `web_pages`, and this store is the in-memory view of them.
 *
 * Two things stay device-local on purpose. `lastUrl` is which page THIS device
 * was reading — syncing it would yank the other device's tab out from under
 * whoever was using it. `savedCollapsed` is a per-screen preference, not
 * something you own.
 */
import {
  clearRecentPages,
  getRecentPages,
  getSavedPages,
  isWebPagesEmpty,
  removeSavedPage,
  toggleSavedPage,
  upsertWebPage,
} from "@readany/core/db";
import { eventBus } from "@readany/core/utils/event-bus";
import { create } from "zustand";
import { withPersist } from "./persist";

const MAX_RECENT = 20;

export interface WebPage {
  url: string;
  title: string;
  visitedAt: number;
}

export interface WebState {
  /** Reopened when the tab mounts, so reading survives leaving the app. */
  lastUrl: string | null;
  recent: WebPage[];
  saved: WebPage[];
  /** Persisted, so a shelf you folded away stays folded next time. */
  savedCollapsed: boolean;
  _hasHydrated: boolean;

  /**
   * Legacy device-local lists, kept only so a device that upgrades can hand
   * its pages to the database once. Read on first load, never written again.
   */
  _legacyRecent?: WebPage[];
  _legacySaved?: WebPage[];

  recordVisit: (page: { url: string; title: string }) => void;
  toggleSaved: (page: { url: string; title: string }) => void;
  toggleSavedCollapsed: () => void;
  removeSaved: (url: string) => void;
  clearRecent: () => void;
  refresh: () => Promise<void>;
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export const useWebStore = create<WebState>()(
  withPersist(
    "web-reader",
    (set, get) => {
      const reload = async () => {
        const [saved, recent] = await Promise.all([getSavedPages(), getRecentPages(MAX_RECENT)]);
        set({
          saved: saved.map(({ url, title, visitedAt }) => ({ url, title, visitedAt })),
          recent: recent.map(({ url, title, visitedAt }) => ({ url, title, visitedAt })),
        });
      };

      /**
       * Move whatever this device already had into the table, once. Guarded on
       * the table being empty rather than on a "migrated" flag: a flag can be
       * true on a device whose rows arrived and were then deleted, and the guard
       * has to answer "is there anything here", not "did we try".
       */
      const migrateLegacy = async () => {
        const { _legacySaved, _legacyRecent } = get();
        const legacy = [...(_legacySaved ?? []), ...(_legacyRecent ?? [])];
        if (legacy.length === 0) return;
        if (!(await isWebPagesEmpty())) return;

        const savedUrls = new Set((_legacySaved ?? []).map((p) => p.url.replace(/\/+$/, "")));
        const seen = new Set<string>();
        for (const page of legacy) {
          const key = page.url.replace(/\/+$/, "");
          if (!key || seen.has(key)) continue;
          seen.add(key);
          await upsertWebPage({
            url: page.url,
            title: page.title,
            visitedAt: page.visitedAt,
            saved: savedUrls.has(key),
          });
        }
        console.log(`[WebStore] Migrated ${seen.size} page(s) from device storage into web_pages`);
      };

      // A sync can bring pages from the other device; the tab should show them
      // without being reopened.
      eventBus.on("sync:completed", () => {
        void reload().catch((e) => console.warn("[WebStore] Reload after sync failed:", e));
      });

      return {
        lastUrl: null,
        recent: [],
        saved: [],
        savedCollapsed: false,
        _hasHydrated: false,

        refresh: async () => {
          await migrateLegacy();
          await reload();
        },

        recordVisit: ({ url, title }) => {
          if (!url) return;
          set({ lastUrl: url });
          void upsertWebPage({ url, title })
            .then(reload)
            .catch((e) => console.warn("[WebStore] recordVisit failed:", e));
        },

        toggleSaved: ({ url, title }) => {
          void toggleSavedPage({ url, title })
            .then(reload)
            .catch((e) => console.warn("[WebStore] toggleSaved failed:", e));
        },

        toggleSavedCollapsed: () => set({ savedCollapsed: !get().savedCollapsed }),

        removeSaved: (url) => {
          void removeSavedPage(url)
            .then(reload)
            .catch((e) => console.warn("[WebStore] removeSaved failed:", e));
        },

        clearRecent: () => {
          void clearRecentPages()
            .then(reload)
            .catch((e) => console.warn("[WebStore] clearRecent failed:", e));
        },
      };
    },
    // Nothing to reset on hydrate.
    undefined,
    // Persisted lists become migration input, not live state: the database is
    // the source of truth the moment this version runs.
    (persisted) => ({
      ...persisted,
      _legacyRecent: persisted.recent ?? [],
      _legacySaved: persisted.saved ?? [],
      recent: [],
      saved: [],
    }),
  ),
);

export function isSavedUrl(saved: WebPage[], url: string): boolean {
  return saved.some((p) => sameUrl(p.url, url));
}
