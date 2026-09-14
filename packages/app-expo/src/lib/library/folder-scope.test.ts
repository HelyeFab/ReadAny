import { describe, expect, it } from "vitest";
import { expandFolderIds } from "./folder-scope";

/**
 * Folders nest, and the library's own folder tiles already show what happens
 * when you forget that: "BookLibrary · 211 books" draws as empty, because its
 * books live in subfolders and only direct children were counted. Picking a
 * folder on the shelf has to mean picking everything under it.
 */
const GROUPS = [
  { id: "lib", parentId: null },
  { id: "jp", parentId: "lib" },
  { id: "jp-grammar", parentId: "jp" },
  { id: "uni", parentId: null },
  { id: "tm351", parentId: "uni" },
  { id: "loose", parentId: null },
];

describe("expandFolderIds", () => {
  it("includes the folder itself", () => {
    expect(expandFolderIds(["loose"], GROUPS)).toEqual(new Set(["loose"]));
  });

  it("includes children and grandchildren", () => {
    expect(expandFolderIds(["lib"], GROUPS)).toEqual(new Set(["lib", "jp", "jp-grammar"]));
  });

  it("takes several folders at once, without duplicating a shared subtree", () => {
    expect(expandFolderIds(["lib", "jp"], GROUPS)).toEqual(new Set(["lib", "jp", "jp-grammar"]));
  });

  it("keeps unrelated trees apart", () => {
    const scope = expandFolderIds(["uni"], GROUPS);
    expect(scope).toEqual(new Set(["uni", "tm351"]));
    expect(scope.has("jp")).toBe(false);
  });

  it("returns nothing for no selection", () => {
    expect(expandFolderIds([], GROUPS)).toEqual(new Set());
  });

  it("survives a cycle in the folder tree instead of hanging", () => {
    // Not supposed to happen, but a sync merge of two devices' folder moves
    // could produce one, and a shelf that hangs is worse than a wrong shelf.
    const cyclic = [
      { id: "a", parentId: "b" },
      { id: "b", parentId: "a" },
    ];
    expect(expandFolderIds(["a"], cyclic)).toEqual(new Set(["a", "b"]));
  });
});
