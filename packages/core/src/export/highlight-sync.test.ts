/**
 * What a sync decides to do, given what is actually on the server.
 *
 * The case that matters most here is the one that got shipped wrong: a book
 * whose file has been DELETED from the server while the registry still
 * remembers where it used to be. Deciding from the record alone makes the app
 * go quiet at exactly the moment it should ask, and quietly recreate a file
 * the reader had removed on purpose.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Book, Highlight } from "../types";

const kv = new Map<string, string>();
vi.mock("../services/platform", () => ({
  getPlatformService: () => ({
    kvGetItem: async (k: string) => kv.get(k) ?? null,
    kvSetItem: async (k: string, v: string) => void kv.set(k, v),
  }),
}));

/** A WebDAV server standing in for Nextcloud: a map of path -> contents. */
const server = {
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  puts: [] as string[],
};

vi.mock("../sync/webdav-client", () => ({
  WebDavClient: class {
    async ensureDirectory(path: string) {
      server.dirs.add(path);
    }
    async exists(path: string) {
      return server.files.has(path);
    }
    async getText(path: string) {
      const value = server.files.get(path);
      if (value === undefined) throw new Error(`404 ${path}`);
      return value;
    }
    async put(path: string, content: string) {
      server.puts.push(path);
      server.files.set(path, content);
    }
    async propfind(dir: string) {
      return [...server.files.keys()]
        .filter((p) => p.slice(0, p.lastIndexOf("/")) === dir)
        .map((p) => ({ name: p.slice(p.lastIndexOf("/") + 1), isCollection: false }));
    }
  },
}));

const { syncBookAnnotationsToWebDav } = await import("./highlight-publisher");
const { HIGHLIGHT_PUBLICATIONS_KEY, getPublication } = await import("./highlight-publication");

const CREDS = { url: "https://nextcloud.example", username: "u", password: "p" };
const NOW = new Date(2026, 8, 14, 21, 0);
const FILING = {
  baseFolder: "/Highlights",
  scheme: "yearMonthBook" as const,
  filenameTemplate: "{title} — {date}",
  format: "markdown" as const,
};
const PATH = "/Highlights/2026/09/Momotaro/Momotaro — 2026-09-14.md";

const book = {
  id: "b1",
  meta: { title: "Momotaro", author: "Anon", language: "ja" },
  tags: [],
  progress: 0,
} as unknown as Book;

function highlight(id: string, text: string): Highlight {
  return {
    id,
    bookId: "b1",
    cfi: `epubcfi(${id})`,
    text,
    color: "yellow",
    chapterTitle: "Chapter 1",
    createdAt: 1,
    updatedAt: 1,
  } as Highlight;
}

function sync(highlights: Highlight[], confirmBeforeCreating = false) {
  return syncBookAnnotationsToWebDav(CREDS, {
    book,
    highlights,
    notes: [],
    filing: FILING,
    now: NOW,
    confirmBeforeCreating,
  });
}

beforeEach(() => {
  kv.clear();
  server.files.clear();
  server.dirs.clear();
  server.puts = [];
});

describe("a book that has never been synced", () => {
  it("asks where to put things rather than choosing for the reader", async () => {
    const result = await sync([highlight("h1", "the sea was calm")], true);
    expect(result.outcome).toBe("needsDestination");
    expect(server.puts).toHaveLength(0);
  });

  it("writes the file once the destination is confirmed", async () => {
    const result = await sync([highlight("h1", "the sea was calm")]);
    expect(result.outcome).toBe("created");
    expect(result.path).toBe(PATH);
    expect(server.files.get(PATH)).toContain("the sea was calm");
  });
});

describe("a book already filed", () => {
  beforeEach(async () => {
    await sync([highlight("h1", "the sea was calm")]);
    server.puts = [];
  });

  it("appends only what is new, without asking again", async () => {
    const result = await sync(
      [highlight("h1", "the sea was calm"), highlight("h2", "a peach came floating")],
      true,
    );
    expect(result.outcome).toBe("appended");
    expect(result.added).toBe(1);

    const doc = server.files.get(PATH) ?? "";
    expect(doc).toContain("## Added 2026-09-14");
    expect(doc).toContain("a peach came floating");
    // the original quote is written once, not repeated by the append
    expect(doc.match(/the sea was calm/g)).toHaveLength(1);
  });

  it("says nothing needs doing when there is nothing new", async () => {
    const result = await sync([highlight("h1", "the sea was calm")], true);
    expect(result.outcome).toBe("upToDate");
    expect(server.puts).toHaveLength(0);
  });

  it("never touches what the reader typed into the file themselves", async () => {
    server.files.set(PATH, `${server.files.get(PATH)}\n\nMy own note, typed by hand.\n`);
    await sync(
      [highlight("h1", "the sea was calm"), highlight("h2", "a peach came floating")],
      true,
    );
    expect(server.files.get(PATH)).toContain("My own note, typed by hand.");
  });
});

describe("the file has been deleted from the server", () => {
  beforeEach(async () => {
    await sync([highlight("h1", "the sea was calm")]);
    // ...and the reader deletes it in Nextcloud. The registry still names it.
    server.files.delete(PATH);
    server.puts = [];
  });

  it("still holds a record pointing at the file that is gone", async () => {
    expect((await getPublication("b1"))?.path).toBe(PATH);
  });

  it("ASKS again instead of silently recreating it", async () => {
    const result = await sync([highlight("h1", "the sea was calm")], true);
    expect(result.outcome).toBe("needsDestination");
    expect(server.puts).toHaveLength(0);
  });

  it("re-sends every highlight once confirmed, not just the unrecorded ones", async () => {
    const result = await sync([
      highlight("h1", "the sea was calm"),
      highlight("h2", "a peach came floating"),
    ]);
    expect(result.outcome).toBe("created");
    const doc = server.files.get(PATH) ?? "";
    expect(doc).toContain("the sea was calm");
    expect(doc).toContain("a peach came floating");
  });
});

describe("a folder the reader exported into by hand", () => {
  it("adopts the existing file instead of dropping a second one beside it", async () => {
    const existing = "/Highlights/2026/09/Momotaro/Momotaro — 2026-09-01.md";
    server.files.set(existing, "# Momotaro\n\n> the sea was calm\n");
    kv.delete(HIGHLIGHT_PUBLICATIONS_KEY);

    const result = await sync(
      [highlight("h1", "the sea was calm"), highlight("h2", "a peach came floating")],
      true,
    );

    expect(result.outcome).toBe("adopted");
    expect(result.path).toBe(existing);
    expect(server.files.has(PATH)).toBe(false);
    // the quote already in the file is not appended a second time
    const doc = server.files.get(existing) ?? "";
    expect(doc.match(/the sea was calm/g)).toHaveLength(1);
    expect(doc).toContain("a peach came floating");
  });
});
