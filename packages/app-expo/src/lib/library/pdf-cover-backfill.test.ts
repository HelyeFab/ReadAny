import { describe, expect, it, vi } from "vitest";
import { backfillPdfCovers, coverlessPdfs, decodeDataUrl } from "./pdf-cover-backfill";

// biome-ignore lint/suspicious/noExplicitAny: test fixtures stand in for full Book records
const book = (over: Record<string, unknown> = {}): any => ({
  id: "b1",
  format: "pdf",
  filePath: "books/b1.pdf",
  syncStatus: "local",
  meta: { title: "A Book", coverUrl: "" },
  ...over,
});

describe("coverlessPdfs", () => {
  it("takes PDFs that have no cover", () => {
    expect(coverlessPdfs([book()])).toHaveLength(1);
  });

  it("leaves EPUBs alone", () => {
    expect(coverlessPdfs([book({ format: "epub" })])).toHaveLength(0);
  });

  it("leaves PDFs that already have a cover", () => {
    expect(coverlessPdfs([book({ meta: { title: "A", coverUrl: "covers/b1.jpg" } })])).toHaveLength(
      0,
    );
  });

  it("skips books whose file is not on this device", () => {
    // Rendering one would mean downloading the whole PDF first — 298 MB for a
    // thumbnail is not a trade to make without being asked.
    expect(coverlessPdfs([book({ syncStatus: "remote" })])).toHaveLength(0);
    expect(coverlessPdfs([book({ filePath: "" })])).toHaveLength(0);
  });
});

describe("decodeDataUrl", () => {
  it("decodes a jpeg data url", () => {
    const decoded = decodeDataUrl(`data:image/jpeg;base64,${globalThis.btoa("hello")}`);
    expect(decoded?.ext).toBe("jpg");
    expect(Array.from(decoded?.bytes ?? [])).toEqual([104, 101, 108, 108, 111]);
  });

  it("keeps png as png", () => {
    expect(decodeDataUrl(`data:image/png;base64,${globalThis.btoa("x")}`)?.ext).toBe("png");
  });

  it("refuses anything that is not an image data url", () => {
    expect(decodeDataUrl("data:text/plain;base64,aGk=")).toBeNull();
    expect(decodeDataUrl("https://example.com/a.jpg")).toBeNull();
    expect(decodeDataUrl("")).toBeNull();
  });
});

describe("backfillPdfCovers", () => {
  const jpeg = `data:image/jpeg;base64,${globalThis.btoa("img")}`;

  function harness(over: Record<string, unknown> = {}) {
    return {
      fileServerUrl: "http://127.0.0.1:8080/",
      renderCover: vi.fn(async () => jpeg),
      saveCover: vi.fn(
        async (bookId: string, _b: Uint8Array, ext: string) => `covers/${bookId}.${ext}`,
      ),
      updateCoverUrl: vi.fn(async () => {}),
      ...over,
    };
  }

  it("renders, saves and records a cover for each book", async () => {
    const h = harness();
    const result = await backfillPdfCovers({
      books: [book(), book({ id: "b2", filePath: "books/b2.pdf" })],
      ...h,
    });

    expect(result).toEqual({ done: 2, total: 2, failed: 0 });
    expect(h.saveCover).toHaveBeenCalledTimes(2);
    expect(h.updateCoverUrl).toHaveBeenCalledWith("b1", "covers/b1.jpg");
  });

  it("builds a url the file server can serve, escaping the path", async () => {
    const h = harness();
    await backfillPdfCovers({ books: [book({ filePath: "books/My Book (2nd ed).pdf" })], ...h });

    expect(h.renderCover).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/books/My%20Book%20(2nd%20ed).pdf",
    );
  });

  it("keeps going when one PDF cannot be rendered", async () => {
    // Encrypted files, truncated downloads and scanner output all fail here.
    const renderCover = vi
      .fn()
      .mockRejectedValueOnce(new Error("password required"))
      .mockResolvedValue(jpeg);
    const h = harness({ renderCover });

    const result = await backfillPdfCovers({
      books: [book(), book({ id: "b2" }), book({ id: "b3" })],
      ...h,
    });

    expect(result).toEqual({ done: 2, total: 3, failed: 1 });
    expect(h.updateCoverUrl).toHaveBeenCalledTimes(2);
  });

  it("treats a non-image result as a failure rather than saving rubbish", async () => {
    const h = harness({ renderCover: vi.fn(async () => "not a data url") });
    const result = await backfillPdfCovers({ books: [book()], ...h });

    expect(result.failed).toBe(1);
    expect(h.saveCover).not.toHaveBeenCalled();
  });

  it("stops when cancelled, without touching the rest", async () => {
    const signal = { cancelled: false };
    const h = harness({
      renderCover: vi.fn(async () => {
        signal.cancelled = true;
        return jpeg;
      }),
    });

    const result = await backfillPdfCovers({
      books: [book(), book({ id: "b2" }), book({ id: "b3" })],
      ...h,
      signal,
    });

    expect(result.done).toBe(1);
    expect(h.renderCover).toHaveBeenCalledTimes(1);
  });

  it("reports progress after every book", async () => {
    const onProgress = vi.fn();
    await backfillPdfCovers({
      books: [book(), book({ id: "b2" })],
      ...harness(),
      onProgress,
    });

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1][0]).toEqual({ done: 2, total: 2, failed: 0 });
  });
});
