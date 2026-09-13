import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILING,
  type FilingOptions,
  applyTemplate,
  buildFiledPath,
  normalizeFolder,
  resolveCollision,
  sanitizeSegment,
} from "./highlight-filing";

const NOW = new Date(2026, 8, 13, 21, 5); // 2026-09-13 21:05, local time on purpose

function filing(overrides: Partial<FilingOptions> = {}): FilingOptions {
  return { ...DEFAULT_FILING, ...overrides };
}

describe("sanitizeSegment", () => {
  it("replaces the characters other filesystems refuse", () => {
    expect(sanitizeSegment('A/B\\C:D*E?F"G<H>I|J')).toBe("A-B-C-D-E-F-G-H-I-J");
  });

  it("keeps Japanese titles intact", () => {
    expect(sanitizeSegment("桃太郎")).toBe("桃太郎");
  });

  it("drops a trailing dot, which Windows and Android silently mangle", () => {
    expect(sanitizeSegment("Chapter One.")).toBe("Chapter One");
  });

  it("falls back when nothing survives", () => {
    expect(sanitizeSegment("///")).toBe("Untitled");
    expect(sanitizeSegment("   ")).toBe("Untitled");
  });

  it("escapes reserved Windows device names", () => {
    expect(sanitizeSegment("CON")).toBe("_CON");
    expect(sanitizeSegment("nul.md")).toBe("_nul.md");
  });

  it("truncates a runaway title", () => {
    expect(sanitizeSegment("x".repeat(400))).toHaveLength(120);
  });
});

describe("normalizeFolder", () => {
  it("normalizes typed folders", () => {
    expect(normalizeFolder("Highlights")).toBe("/Highlights");
    expect(normalizeFolder("/Highlights/")).toBe("/Highlights");
    expect(normalizeFolder("//a///b//")).toBe("/a/b");
    expect(normalizeFolder("")).toBe("/");
  });

  it("cannot be walked out of with ..", () => {
    // ".." sanitizes to "" once trailing dots go, so it drops out entirely
    // rather than climbing above the DAV root.
    expect(normalizeFolder("/Highlights/../../etc")).toBe("/Highlights/etc");
  });
});

describe("applyTemplate", () => {
  it("substitutes known tokens and leaves unknown ones alone", () => {
    expect(applyTemplate("{title} {nope}", { title: "Momotaro" })).toBe("Momotaro {nope}");
  });
});

describe("buildFiledPath", () => {
  const ctx = { title: "桃太郎", author: "楠山正雄", now: NOW };

  it("files flat", () => {
    expect(buildFiledPath(filing({ scheme: "flat" }), ctx).path).toBe(
      "/Highlights/桃太郎 — 2026-09-13.md",
    );
  });

  it("files by book", () => {
    expect(buildFiledPath(filing({ scheme: "book" }), ctx).dir).toBe("/Highlights/桃太郎");
  });

  it("files by author", () => {
    expect(buildFiledPath(filing({ scheme: "author" }), ctx).dir).toBe("/Highlights/楠山正雄");
  });

  it("files by year and month, zero-padded", () => {
    expect(buildFiledPath(filing({ scheme: "yearMonth" }), ctx).dir).toBe("/Highlights/2026/09");
  });

  it("files by year, month and book — the default", () => {
    const filed = buildFiledPath(filing(), ctx);
    expect(filed.dir).toBe("/Highlights/2026/09/桃太郎");
    expect(filed.filename).toBe("桃太郎 — 2026-09-13.md");
  });

  it("files by date", () => {
    expect(buildFiledPath(filing({ scheme: "date" }), ctx).dir).toBe("/Highlights/2026-09-13");
  });

  it("uses the json extension for json exports", () => {
    expect(buildFiledPath(filing({ format: "json" }), ctx).filename).toBe(
      "桃太郎 — 2026-09-13.json",
    );
  });

  it("honours a custom filename template", () => {
    const filed = buildFiledPath(
      filing({
        scheme: "flat",
        filenameTemplate: "{author} - {title} ({year}-{month}-{day} {time})",
      }),
      ctx,
    );
    expect(filed.filename).toBe("楠山正雄 - 桃太郎 (2026-09-13 21-05).md");
  });

  it("sanitizes a slash in the title instead of creating a folder from it", () => {
    const filed = buildFiledPath(filing({ scheme: "book" }), { ...ctx, title: "War/Peace" });
    expect(filed.dir).toBe("/Highlights/War-Peace");
  });

  it("survives a missing author", () => {
    const filed = buildFiledPath(filing({ scheme: "author" }), { ...ctx, author: undefined });
    expect(filed.dir).toBe("/Highlights/Unknown author");
  });

  it("handles a base folder of /", () => {
    const filed = buildFiledPath(filing({ baseFolder: "/", scheme: "flat" }), ctx);
    expect(filed.path).toBe("/桃太郎 — 2026-09-13.md");
  });
});

describe("resolveCollision", () => {
  const filed = { dir: "/Highlights", filename: "Book.md", path: "/Highlights/Book.md" };

  it("keeps the name when nothing is in the way", async () => {
    const result = await resolveCollision(filed, async () => false);
    expect(result.path).toBe("/Highlights/Book.md");
  });

  it("counts up past what is already there", async () => {
    const taken = new Set(["/Highlights/Book.md", "/Highlights/Book (2).md"]);
    const result = await resolveCollision(filed, async (path) => taken.has(path));
    expect(result.filename).toBe("Book (3).md");
    expect(result.path).toBe("/Highlights/Book (3).md");
  });

  it("gives up rather than looping forever", async () => {
    await expect(resolveCollision(filed, async () => true, 3)).rejects.toThrow(
      /Could not find a free filename/,
    );
  });
});
