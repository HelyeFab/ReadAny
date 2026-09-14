/**
 * What the shelf is currently showing.
 *
 * Folders are how the library is organised, but they are not always how you
 * want to look at it. The shelf treats them as a filter instead of a route:
 * everything at once, one folder, or a handful of folders side by side.
 *
 * Kept out of the library store because that one is rebuilt from the database
 * on every load; this is a preference about looking, and it should survive
 * closing the app.
 */
import { create } from "zustand";
import { withPersist } from "./persist";

export { expandFolderIds } from "@/lib/library/folder-scope";

export type ShelfScopeMode = "all" | "folders";

export interface ShelfState {
  mode: ShelfScopeMode;
  /** Folder ids when mode is "folders". Books in their subfolders count too. */
  groupIds: string[];
  _hasHydrated: boolean;

  showEverything: () => void;
  showFolders: (groupIds: string[]) => void;
  toggleFolder: (groupId: string) => void;
}

export const useShelfStore = create<ShelfState>()(
  withPersist("library-shelf", (set, get) => ({
    mode: "all",
    groupIds: [],
    _hasHydrated: false,

    showEverything: () => set({ mode: "all", groupIds: [] }),

    /** Choosing no folders means showing everything, not showing nothing. */
    showFolders: (groupIds) =>
      groupIds.length > 0 ? set({ mode: "folders", groupIds }) : set({ mode: "all", groupIds: [] }),

    toggleFolder: (groupId) => {
      const current = get().groupIds;
      const next = current.includes(groupId)
        ? current.filter((id) => id !== groupId)
        : [...current, groupId];
      get().showFolders(next);
    },
  })),
);
