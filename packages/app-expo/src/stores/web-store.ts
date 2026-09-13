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

  recordVisit: (page: { url: string; title: string }) => void;
  toggleSaved: (page: { url: string; title: string }) => void;
  toggleSavedCollapsed: () => void;
  removeSaved: (url: string) => void;
  clearRecent: () => void;
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export const useWebStore = create<WebState>()(
  withPersist("web-reader", (set, get) => ({
    lastUrl: null,
    recent: [],
    saved: [],
    savedCollapsed: false,
    _hasHydrated: false,

    recordVisit: ({ url, title }) => {
      if (!url) return;
      const entry: WebPage = { url, title, visitedAt: Date.now() };
      const recent = [entry, ...get().recent.filter((p) => !sameUrl(p.url, url))].slice(
        0,
        MAX_RECENT,
      );
      set({ lastUrl: url, recent });
    },

    toggleSaved: ({ url, title }) => {
      const saved = get().saved;
      const existing = saved.find((p) => sameUrl(p.url, url));
      if (existing) {
        set({ saved: saved.filter((p) => !sameUrl(p.url, url)) });
        return;
      }
      set({ saved: [{ url, title, visitedAt: Date.now() }, ...saved] });
    },

    toggleSavedCollapsed: () => set({ savedCollapsed: !get().savedCollapsed }),

    removeSaved: (url) => set({ saved: get().saved.filter((p) => !sameUrl(p.url, url)) }),

    clearRecent: () => set({ recent: [] }),
  })),
);

export function isSavedUrl(saved: WebPage[], url: string): boolean {
  return saved.some((p) => sameUrl(p.url, url));
}
