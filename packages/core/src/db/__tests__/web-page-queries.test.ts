import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockExecute = vi.fn();
const mockInsertTombstone = vi.fn();

vi.mock("../db-core", () => ({
  getDB: vi.fn(async () => ({ select: mockSelect, execute: mockExecute })),
  getDeviceId: vi.fn(async () => "device-a"),
  nextSyncVersion: vi.fn(async () => 7),
  insertTombstone: (...args: unknown[]) => mockInsertTombstone(...args),
}));

const {
  clearRecentPages,
  deleteWebPage,
  getSavedPages,
  normalizeUrl,
  removeSavedPage,
  toggleSavedPage,
  upsertWebPage,
} = await import("../web-page-queries");

const row = (over: Record<string, unknown> = {}) => ({
  id: "web-1",
  url: "https://example.com/a",
  title: "A",
  visited_at: 100,
  saved: 0,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockResolvedValue([]);
  mockExecute.mockResolvedValue(undefined);
});

describe("url identity", () => {
  it("treats a trailing slash as the same page", () => {
    expect(normalizeUrl("https://example.com/a/")).toBe(normalizeUrl("https://example.com/a"));
  });

  it("stores the normalized url, so two visits cannot become two rows", async () => {
    await upsertWebPage({ url: "https://example.com/a/", title: "A" });
    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(params[1]).toBe("https://example.com/a");
  });

  it("refuses a url that normalizes to nothing", async () => {
    expect(await upsertWebPage({ url: "", title: "" })).toBeNull();
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("upsertWebPage", () => {
  it("keeps an existing row's saved state when recording a visit", async () => {
    mockSelect.mockResolvedValue([row({ saved: 1 })]);
    await upsertWebPage({ url: "https://example.com/a", title: "A" });

    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe("web-1"); // reuses the row rather than adding another
    expect(params[4]).toBe(1); // still saved
  });

  it("stamps sync columns so the row can travel", async () => {
    await upsertWebPage({ url: "https://example.com/a", title: "A" });
    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(params[6]).toBe(7); // sync_version
    expect(params[7]).toBe("device-a"); // last_modified_by
    expect(typeof params[5]).toBe("number"); // updated_at
  });
});

describe("saving", () => {
  it("toggles an unsaved page on", async () => {
    mockSelect.mockResolvedValue([row({ saved: 0 })]);
    expect(await toggleSavedPage({ url: "https://example.com/a", title: "A" })).toBe(true);
  });

  it("toggles a saved page off", async () => {
    mockSelect.mockResolvedValue([row({ saved: 1 })]);
    expect(await toggleSavedPage({ url: "https://example.com/a", title: "A" })).toBe(false);
  });

  it("unsaving keeps the row, so the page stays in history", async () => {
    mockSelect.mockResolvedValue([row({ saved: 1 })]);
    await removeSavedPage("https://example.com/a");

    expect(mockInsertTombstone).not.toHaveBeenCalled();
    const params = mockExecute.mock.calls[0][1] as unknown[];
    expect(params[4]).toBe(0);
  });

  it("reads back saved pages newest first", async () => {
    mockSelect.mockResolvedValue([row({ saved: 1 })]);
    const [page] = await getSavedPages();
    expect(page).toEqual({
      id: "web-1",
      url: "https://example.com/a",
      title: "A",
      visitedAt: 100,
      saved: true,
    });
    expect(mockSelect.mock.calls[0][0]).toMatch(/ORDER BY visited_at DESC/);
  });
});

describe("deletion", () => {
  it("writes a tombstone, or the other device's copy comes back on next sync", async () => {
    await deleteWebPage("web-1");
    expect(mockInsertTombstone).toHaveBeenCalledWith(expect.anything(), "web-1", "web_pages");
    expect(mockExecute).toHaveBeenCalledWith("DELETE FROM web_pages WHERE id = ?", ["web-1"]);
  });

  it("clearing history deletes only unsaved rows", async () => {
    mockSelect.mockResolvedValue([{ id: "web-1" }, { id: "web-2" }]);
    await clearRecentPages();

    expect(mockSelect.mock.calls[0][0]).toMatch(/WHERE saved = 0/);
    expect(mockInsertTombstone).toHaveBeenCalledTimes(2);
  });
});
