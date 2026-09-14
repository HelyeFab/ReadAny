import { describe, expect, it } from "vitest";
import type { Book, Highlight, Note } from "../types";
import {
  type PublicationRecord,
  isAdoptableExport,
  mergeJsonIncrement,
  pickAdoptionCandidate,
  recordAfterPublish,
  renderMarkdownIncrement,
  selectMissingFromDocument,
  selectUnpublished,
} from "./highlight-publication";

const NOW = new Date(2026, 8, 15, 9, 30); // 2026-09-15, local time on purpose

function highlight(overrides: Partial<Highlight> = {}): Highlight {
  return {
    id: "h1",
    bookId: "b1",
    cfi: "epubcfi(/6/4!/4/2)",
    text: "the sea was calm",
    color: "yellow",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  } as Highlight;
}

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    bookId: "b1",
    title: "A thought",
    content: "something worth keeping",
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function book(): Book {
  return {
    id: "b1",
    meta: { title: "Momotaro", author: "Anon", language: "ja" },
    tags: [],
    progress: 0,
  } as unknown as Book;
}

function record(overrides: Partial<PublicationRecord> = {}): PublicationRecord {
  return {
    bookId: "b1",
    path: "/Highlights/2026/09/Momotaro/Momotaro.md",
    format: "markdown",
    highlightIds: [],
    noteIds: [],
    lastPublishedAt: 0,
    ...overrides,
  };
}

describe("selectUnpublished", () => {
  it("treats everything as new when the book has never been published", () => {
    const result = selectUnpublished([highlight()], [note()], null);
    expect(result.highlights).toHaveLength(1);
    expect(result.notes).toHaveLength(1);
  });

  it("drops the annotations already sent", () => {
    const result = selectUnpublished(
      [highlight({ id: "h1" }), highlight({ id: "h2" })],
      [note({ id: "n1" })],
      record({ highlightIds: ["h1"], noteIds: ["n1"] }),
    );
    expect(result.highlights.map((h) => h.id)).toEqual(["h2"]);
    expect(result.notes).toHaveLength(0);
  });

  it("does not resend a highlight just because its note was edited", () => {
    const result = selectUnpublished(
      [highlight({ id: "h1", note: "a new thought", updatedAt: 999 })],
      [],
      record({ highlightIds: ["h1"] }),
    );
    expect(result.highlights).toHaveLength(0);
  });
});

describe("selectMissingFromDocument", () => {
  it("skips quotes the document already contains", () => {
    const doc = "# Momotaro\n\n> the sea was calm\n";
    const result = selectMissingFromDocument(
      [highlight({ id: "h1" }), highlight({ id: "h2", text: "a peach came floating" })],
      [],
      doc,
    );
    expect(result.highlights.map((h) => h.id)).toEqual(["h2"]);
  });

  it("keeps everything when the document is empty", () => {
    const result = selectMissingFromDocument([highlight()], [note()], "");
    expect(result.highlights).toHaveLength(1);
    expect(result.notes).toHaveLength(1);
  });

  it("ignores blank annotations rather than matching them everywhere", () => {
    const result = selectMissingFromDocument([highlight({ text: "   " })], [], "anything");
    expect(result.highlights).toHaveLength(0);
  });
});

describe("renderMarkdownIncrement", () => {
  it("opens a dated section under a rule so it reads as an addition", () => {
    const out = renderMarkdownIncrement({
      highlights: [highlight({ chapterTitle: "Chapter 1" })],
      notes: [],
      format: "markdown",
      now: NOW,
    });
    expect(out).toContain("## Added 2026-09-15");
    expect(out.startsWith("\n---\n")).toBe(true);
    expect(out).toContain("### Chapter 1");
    expect(out).toContain("> the sea was calm");
  });

  it("carries a highlight's own note through", () => {
    const out = renderMarkdownIncrement({
      highlights: [highlight({ note: "remember this" })],
      notes: [],
      format: "markdown",
      now: NOW,
    });
    expect(out).toContain("**Note:** remember this");
  });

  it("uses the callout syntax for obsidian", () => {
    const out = renderMarkdownIncrement({
      highlights: [highlight()],
      notes: [],
      format: "obsidian",
      now: NOW,
    });
    expect(out).toContain("> [!quote] Highlight");
  });

  it("leaves notes attached to a highlight out of the standalone section", () => {
    const out = renderMarkdownIncrement({
      highlights: [],
      notes: [note({ highlightId: "h1" })],
      format: "markdown",
      now: NOW,
    });
    expect(out).not.toContain("### Notes");
  });

  it("appends standalone notes with their titles", () => {
    const out = renderMarkdownIncrement({
      highlights: [],
      notes: [note()],
      format: "markdown",
      now: NOW,
    });
    expect(out).toContain("### Notes");
    expect(out).toContain("#### A thought");
    expect(out).toContain("something worth keeping");
  });
});

describe("mergeJsonIncrement", () => {
  const existing = JSON.stringify({
    book: { id: "b1", title: "Momotaro" },
    exportedAt: "2026-09-14T00:00:00.000Z",
    highlights: [{ id: "h1", text: "the sea was calm" }],
    notes: [],
  });

  it("adds only the ids that are not there yet", () => {
    const merged = JSON.parse(
      mergeJsonIncrement({
        existing,
        book: book(),
        highlights: [highlight({ id: "h1" }), highlight({ id: "h2", text: "a peach" })],
        notes: [],
        now: NOW,
      }),
    );
    expect(merged.highlights.map((h: { id: string }) => h.id)).toEqual(["h1", "h2"]);
  });

  it("leaves the entries already in the file exactly as they were", () => {
    const merged = JSON.parse(
      mergeJsonIncrement({
        existing,
        book: book(),
        highlights: [highlight({ id: "h1", text: "REWRITTEN" })],
        notes: [],
        now: NOW,
      }),
    );
    expect(merged.highlights[0].text).toBe("the sea was calm");
  });

  it("refuses to touch a file it cannot parse", () => {
    expect(() =>
      mergeJsonIncrement({
        existing: "{ not json",
        book: book(),
        highlights: [highlight()],
        notes: [],
        now: NOW,
      }),
    ).toThrow(/could not be parsed/);
  });
});

describe("isAdoptableExport", () => {
  it("matches a file the export sheet would have produced", () => {
    expect(isAdoptableExport("Momotaro — 2026-09-13.md", "Momotaro", "markdown")).toBe(true);
  });

  it("ignores another book in a shared folder", () => {
    expect(isAdoptableExport("Kaguyahime — 2026-09-13.md", "Momotaro", "markdown")).toBe(false);
  });

  it("ignores a file of the wrong format", () => {
    expect(isAdoptableExport("Momotaro.json", "Momotaro", "markdown")).toBe(false);
    expect(isAdoptableExport("Momotaro.json", "Momotaro", "json")).toBe(true);
  });

  it("matches the sanitized title, since that is what was written", () => {
    expect(isAdoptableExport("A-B — 2026-09-13.md", "A/B", "markdown")).toBe(true);
  });
});

describe("pickAdoptionCandidate", () => {
  it("prefers the file most recently written", () => {
    const pick = pickAdoptionCandidate([
      { name: "old.md", lastModified: "Mon, 01 Sep 2026 10:00:00 GMT" },
      { name: "new.md", lastModified: "Mon, 14 Sep 2026 10:00:00 GMT" },
    ]);
    expect(pick?.name).toBe("new.md");
  });

  it("falls back to a stable order when nothing has a date", () => {
    const pick = pickAdoptionCandidate([{ name: "b.md" }, { name: "a.md" }]);
    expect(pick?.name).toBe("a.md");
  });

  it("returns null when there is nothing to adopt", () => {
    expect(pickAdoptionCandidate([])).toBeNull();
  });
});

describe("recordAfterPublish", () => {
  it("unions the new ids onto what was already sent", () => {
    const next = recordAfterPublish({
      bookId: "b1",
      path: "/Highlights/Momotaro.md",
      format: "markdown",
      previous: record({ highlightIds: ["h1"] }),
      highlights: [highlight({ id: "h2" })],
      notes: [note({ id: "n1" })],
      now: NOW,
    });
    expect(next.highlightIds).toEqual(["h1", "h2"]);
    expect(next.noteIds).toEqual(["n1"]);
    expect(next.lastPublishedAt).toBe(NOW.getTime());
  });

  it("does not record the same id twice", () => {
    const next = recordAfterPublish({
      bookId: "b1",
      path: "/Highlights/Momotaro.md",
      format: "markdown",
      previous: record({ highlightIds: ["h1"] }),
      highlights: [highlight({ id: "h1" })],
      notes: [],
      now: NOW,
    });
    expect(next.highlightIds).toEqual(["h1"]);
  });
});
