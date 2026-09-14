import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceSyncPayload } from "../../sync/simple-sync";

const mockCollectChanges = vi.fn();
const mockApplyChanges = vi.fn();

vi.mock("../../sync/simple-sync", () => ({
  collectChanges: (since: number) => mockCollectChanges(since),
  applyChanges: (payload: unknown, options: unknown) => mockApplyChanges(payload, options),
  SYNC_TABLE_NAMES: ["books", "highlights"],
}));

const {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  createLibraryBackup,
  describeBackup,
  isLibraryBackup,
  parseBackup,
  restoreLibraryBackup,
  serializeBackup,
} = await import("../library-backup");

function snapshot(overrides: Partial<DeviceSyncPayload> = {}): DeviceSyncPayload {
  return {
    deviceId: "device-a",
    timestamp: 1_700_000_000_000,
    since: 0,
    tables: {
      books: { records: [{ id: "b1", updated_at: 5 }], deletedIds: [] },
      highlights: { records: [], deletedIds: ["h9"] },
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCollectChanges.mockResolvedValue(snapshot());
  mockApplyChanges.mockResolvedValue({ applied: 1, skipped: 0 });
});

describe("createLibraryBackup", () => {
  it("snapshots from the beginning of time, not since the last sync", async () => {
    await createLibraryBackup();
    expect(mockCollectChanges).toHaveBeenCalledWith(0);
  });

  it("counts records per table so the file can describe itself", async () => {
    const backup = await createLibraryBackup({ appVersion: "1.2.3" });

    expect(backup.manifest.format).toBe(BACKUP_FORMAT);
    expect(backup.manifest.version).toBe(BACKUP_VERSION);
    expect(backup.manifest.deviceId).toBe("device-a");
    expect(backup.manifest.appVersion).toBe("1.2.3");
    expect(backup.manifest.counts).toEqual({ books: 1, highlights: 0 });
    expect(backup.manifest.totalRecords).toBe(1);
  });

  it("omits appVersion rather than writing undefined into the file", async () => {
    const backup = await createLibraryBackup();
    expect("appVersion" in backup.manifest).toBe(false);
  });
});

describe("parseBackup", () => {
  it("round-trips through serialization", async () => {
    const backup = await createLibraryBackup();
    const parsed = parseBackup(serializeBackup(backup));
    expect(parsed).toEqual(backup);
  });

  it("rejects malformed json", () => {
    expect(parseBackup("{not json")).toBeNull();
  });

  it("rejects a json file that is not one of ours", () => {
    expect(parseBackup(JSON.stringify({ hello: "world" }))).toBeNull();
    expect(parseBackup(JSON.stringify({ manifest: { format: "something-else" } }))).toBeNull();
  });

  it("rejects a backup whose tables are not changesets", () => {
    const broken = {
      manifest: { format: BACKUP_FORMAT, version: 1, createdAt: 0, deviceId: "d", counts: {} },
      snapshot: { deviceId: "d", timestamp: 0, since: 0, tables: { books: { records: "nope" } } },
    };
    expect(isLibraryBackup(broken)).toBe(false);
  });

  it("accepts a backup from a newer format version, so restore can explain the refusal", () => {
    const future = {
      manifest: { format: BACKUP_FORMAT, version: 99, createdAt: 0, deviceId: "d", counts: {} },
      snapshot: snapshot(),
    };
    expect(isLibraryBackup(future)).toBe(true);
  });
});

describe("describeBackup", () => {
  it("reports tables this build cannot restore", async () => {
    mockCollectChanges.mockResolvedValue(
      snapshot({
        tables: {
          books: { records: [{ id: "b1" }], deletedIds: [] },
          web_pages: { records: [{ id: "w1" }], deletedIds: [] },
        },
      }),
    );
    const backup = await createLibraryBackup();

    expect(describeBackup(backup).unreadableTables).toEqual(["web_pages"]);
  });

  it("does not warn about an unknown table that carries no records", async () => {
    mockCollectChanges.mockResolvedValue(
      snapshot({
        tables: {
          books: { records: [{ id: "b1" }], deletedIds: [] },
          web_pages: { records: [], deletedIds: [] },
        },
      }),
    );
    const backup = await createLibraryBackup();

    expect(describeBackup(backup).unreadableTables).toEqual([]);
  });
});

describe("restoreLibraryBackup", () => {
  it("forces the records in, because the local state is the thing being repaired", async () => {
    const backup = await createLibraryBackup();
    const result = await restoreLibraryBackup(backup);

    expect(mockApplyChanges).toHaveBeenCalledWith(backup.snapshot, { forceApply: true });
    expect(result).toEqual({ applied: 1, skipped: 0 });
  });

  it("refuses a backup from a newer app instead of half-restoring it", async () => {
    const backup = await createLibraryBackup();
    backup.manifest.version = BACKUP_VERSION + 1;

    await expect(restoreLibraryBackup(backup)).rejects.toThrow(/newer version/i);
    expect(mockApplyChanges).not.toHaveBeenCalled();
  });
});
