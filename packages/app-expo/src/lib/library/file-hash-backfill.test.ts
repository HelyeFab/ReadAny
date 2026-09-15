import { describe, expect, it, vi } from "vitest";
import {
  backfillFileHashes,
  booksMissingFileHash,
  existingFileHashes,
  orderBySizeAscending,
  shouldReportFraction,
} from "./file-hash-backfill";

// biome-ignore lint/suspicious/noExplicitAny: test fixtures stand in for full Book records
const book = (over: Record<string, unknown> = {}): any => ({
  id: "b1",
  format: "epub",
  filePath: "books/b1.epub",
  syncStatus: "local",
  meta: { title: "A Book" },
  ...over,
});

describe("booksMissingFileHash", () => {
  it("takes books that have no hash", () => {
    expect(booksMissingFileHash([book()])).toHaveLength(1);
  });

  it("leaves books that already have one", () => {
    expect(booksMissingFileHash([book({ fileHash: "abc" })])).toHaveLength(0);
  });

  it("skips books whose file is not on this device", () => {
    // Hashing one would mean downloading it in full first, to learn something
    // the device that uploaded it already knows and will sync over anyway.
    expect(booksMissingFileHash([book({ syncStatus: "remote" })])).toHaveLength(0);
    expect(booksMissingFileHash([book({ filePath: "" })])).toHaveLength(0);
  });
});

describe("existingFileHashes", () => {
  it("collects the hashes already in the library", () => {
    const hashes = existingFileHashes([book({ fileHash: "aa" }), book(), book({ fileHash: "bb" })]);
    expect([...hashes].sort()).toEqual(["aa", "bb"]);
  });
});

describe("orderBySizeAscending", () => {
  it("puts the small files first and does not mutate the input", () => {
    const input = [{ size: 300 }, { size: 1 }, { size: 20 }];
    expect(orderBySizeAscending(input).map((e) => e.size)).toEqual([1, 20, 300]);
    expect(input.map((e) => e.size)).toEqual([300, 1, 20]);
  });
});

describe("shouldReportFraction", () => {
  it("always reports the first reading", () => {
    expect(shouldReportFraction(undefined, 0.001)).toBe(true);
  });

  it("swallows a step too small to see", () => {
    expect(shouldReportFraction(0.5, 0.505)).toBe(false);
  });

  it("reports once the bar would visibly move", () => {
    expect(shouldReportFraction(0.5, 0.53)).toBe(true);
  });

  it("always reports the end, however small the last step", () => {
    expect(shouldReportFraction(0.999, 1)).toBe(true);
  });
});

function harness(over: Partial<Parameters<typeof backfillFileHashes>[0]> = {}) {
  const saved: Array<[string, string]> = [];
  return {
    saved,
    options: {
      books: [book()],
      statFile: vi.fn(async () => 100),
      hashFile: vi.fn(async () => "hash-1"),
      saveFileHash: vi.fn(async (id: string, hash: string) => {
        saved.push([id, hash]);
      }),
      ...over,
    } as Parameters<typeof backfillFileHashes>[0],
  };
}

describe("backfillFileHashes", () => {
  it("hashes a book and writes the hash to its record", async () => {
    const h = harness();
    const result = await backfillFileHashes(h.options);

    expect(result).toMatchObject({ done: 1, total: 1, failed: 0, duplicates: 0 });
    expect(h.saved).toEqual([["b1", "hash-1"]]);
  });

  it("hashes the small books before the large ones", async () => {
    const order: string[] = [];
    const h = harness({
      books: [
        book({ id: "big", filePath: "big.epub" }),
        book({ id: "small", filePath: "small.epub" }),
        book({ id: "mid", filePath: "mid.epub" }),
      ],
      statFile: async (path: string) =>
        path === "big.epub" ? 300_000_000 : path === "mid.epub" ? 5_000_000 : 400_000,
      hashFile: async (path: string) => {
        order.push(path);
        return `hash-${path}`;
      },
    });

    await backfillFileHashes(h.options);
    expect(order).toEqual(["small.epub", "mid.epub", "big.epub"]);
  });

  it("counts a book whose file has gone missing as a failure and never hashes it", async () => {
    const hashFile = vi.fn(async () => "hash-1");
    const h = harness({ statFile: async () => 0, hashFile });

    const result = await backfillFileHashes(h.options);
    expect(result).toMatchObject({ done: 0, failed: 1 });
    expect(hashFile).not.toHaveBeenCalled();
  });

  it("counts an unreadable file as a failure and carries on with the rest", async () => {
    const h = harness({
      books: [book({ id: "bad", filePath: "bad.epub" }), book({ id: "good", filePath: "ok.epub" })],
      // hashBookFile returns undefined rather than throwing, so the run has to
      // treat that as the failure it is instead of writing nothing quietly.
      hashFile: async (path: string) => (path === "bad.epub" ? undefined : "hash-ok"),
    });

    const result = await backfillFileHashes(h.options);
    expect(result).toMatchObject({ done: 1, failed: 1 });
    expect(h.saved).toEqual([["good", "hash-ok"]]);
  });

  it("notices two books that are the same file", async () => {
    const h = harness({
      books: [book({ id: "one", filePath: "a.epub" }), book({ id: "two", filePath: "b.epub" })],
      hashFile: async () => "same",
    });

    const result = await backfillFileHashes(h.options);
    expect(result).toMatchObject({ done: 2, duplicates: 1 });
  });

  it("notices a book that matches one already hashed", async () => {
    const h = harness({ knownHashes: ["hash-1"] });
    expect(await backfillFileHashes(h.options)).toMatchObject({ done: 1, duplicates: 1 });
  });

  it("stops when cancelled, keeping what it has already written", async () => {
    const signal = { cancelled: false };
    const h = harness({
      books: [book({ id: "one", filePath: "a.epub" }), book({ id: "two", filePath: "b.epub" })],
      hashFile: async (path: string) => {
        signal.cancelled = true;
        return `hash-${path}`;
      },
      signal,
    });

    const result = await backfillFileHashes(h.options);
    expect(result.done).toBe(1);
    expect(h.saved).toHaveLength(1);
  });

  it("reports the book it is on, throttled to steps the eye can see", async () => {
    const seen: Array<number | undefined> = [];
    const h = harness({
      hashFile: async (_path: string, _size: number, onProgress) => {
        for (let i = 1; i <= 100; i++) onProgress(i, 100);
        return "hash-1";
      },
      onProgress: (p) => {
        if (p.current) seen.push(p.currentFraction);
      },
    });

    await backfillFileHashes(h.options);
    // 100 callbacks, reported at roughly every 2%.
    expect(seen.length).toBeGreaterThan(5);
    expect(seen.length).toBeLessThan(60);
    expect(seen.at(-1)).toBe(1);
  });
});
