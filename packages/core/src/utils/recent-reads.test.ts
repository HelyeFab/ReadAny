import { describe, expect, it } from "vitest";
import type { Book } from "../types/book";
import { pruneDismissedRecents, selectRecentReads } from "./recent-reads";

function book(id: string, overrides: Partial<Book> = {}): Book {
  return {
    id,
    filePath: `/books/${id}.epub`,
    format: "epub",
    meta: { title: id, author: "" },
    addedAt: 0,
    updatedAt: 0,
    progress: 0.5,
    lastOpenedAt: 1_000,
    isVectorized: false,
    vectorizeProgress: 0,
    tags: [],
    syncStatus: "local",
    ...overrides,
  };
}

describe("selectRecentReads", () => {
  it("orders started books by how recently they were opened", () => {
    const picked = selectRecentReads({
      books: [
        book("old", { lastOpenedAt: 100 }),
        book("newest", { lastOpenedAt: 900 }),
        book("middle", { lastOpenedAt: 500 }),
      ],
      dismissed: {},
    });
    expect(picked.map((b) => b.id)).toEqual(["newest", "middle", "old"]);
  });

  it("ranks anything started above an untouched import, however fresh", () => {
    // An import stamps lastOpenedAt, so recency alone would promote a book
    // that has never been read over the one actually in progress.
    const picked = selectRecentReads({
      books: [
        book("just-imported", { lastOpenedAt: 9_000, progress: 0 }),
        book("being-read", { lastOpenedAt: 100, progress: 0.3 }),
      ],
      dismissed: {},
    });
    expect(picked.map((b) => b.id)).toEqual(["being-read", "just-imported"]);
  });

  it("leaves out books that cannot be resumed", () => {
    const picked = selectRecentReads({
      books: [
        book("finished", { progress: 1 }),
        book("all-but-finished", { progress: 0.996 }),
        book("deleted", { deletedAt: 5 }),
        book("never-opened", { lastOpenedAt: undefined }),
        book("downloading", { syncStatus: "downloading" }),
        book("fine"),
      ],
      dismissed: {},
    });
    expect(picked.map((b) => b.id)).toEqual(["fine"]);
  });

  it("hides a dismissed book until it is opened again", () => {
    const dismissed = { quiet: 500 };
    expect(
      selectRecentReads({ books: [book("quiet", { lastOpenedAt: 400 })], dismissed }),
    ).toHaveLength(0);
    // Opening it moves lastOpenedAt past the dismissal, so it returns by itself.
    expect(
      selectRecentReads({ books: [book("quiet", { lastOpenedAt: 600 })], dismissed }),
    ).toHaveLength(1);
  });

  it("treats a dismissal at the exact open time as still dismissed", () => {
    expect(
      selectRecentReads({
        books: [book("quiet", { lastOpenedAt: 500 })],
        dismissed: { quiet: 500 },
      }),
    ).toHaveLength(0);
  });

  it("honours the limit", () => {
    const books = Array.from({ length: 12 }, (_, i) => book(`b${i}`, { lastOpenedAt: i }));
    expect(selectRecentReads({ books, dismissed: {}, limit: 4 })).toHaveLength(4);
    expect(selectRecentReads({ books, dismissed: {}, limit: 0 })).toHaveLength(0);
  });
});

describe("pruneDismissedRecents", () => {
  it("forgets entries for books that are gone, and ones already spent", () => {
    const dismissed = { gone: 100, removed: 100, reopened: 100, still: 100 };
    const pruned = pruneDismissedRecents(dismissed, [
      book("removed", { deletedAt: 7 }),
      book("reopened", { lastOpenedAt: 200 }),
      book("still", { lastOpenedAt: 50 }),
    ]);
    expect(pruned).toEqual({ still: 100 });
  });
});
