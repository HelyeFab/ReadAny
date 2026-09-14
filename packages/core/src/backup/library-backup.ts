/**
 * Library backup — one file that carries a whole library's records.
 *
 * This is deliberately the same payload the sync engine already moves between
 * devices: `collectChanges(0)` is a complete snapshot of every synced table, and
 * `applyChanges` is the merge that puts it back. A backup is therefore not a
 * second, parallel description of the library that could drift out of step with
 * sync — it is the sync snapshot, written to a file instead of to a server.
 *
 * What it holds: records, not files. Books, groups, highlights, notes,
 * bookmarks, tags, threads, messages, skills and reading sessions — everything
 * that says what you have and where you are in it. The .epub and .pdf files
 * themselves stay where they are; a restored device knows about every book and
 * downloads the files from the sync remote.
 *
 * Alongside the snapshot it can carry a small settings section, because some of
 * what makes the app yours is not in SQLite and so cannot be in a sync snapshot
 * — the AI endpoint, model and key that a reading companion needs to say
 * anything at all. That section is optional and additive: a file without one
 * restores exactly as before, and a build that predates it ignores what it
 * cannot read rather than refusing the whole restore. That is also why the
 * format version does not move for it.
 */
import { SYNC_TABLE_NAMES, applyChanges, collectChanges } from "../sync/simple-sync";
import type { DeviceSyncPayload } from "../sync/simple-sync";
import { describeBackupSettings, isBackupSettings } from "./backup-settings";
import type { BackupSettings, BackupSettingsSummary } from "./backup-settings";

/** Marker written into every backup so a stray .json can be told apart from ours. */
export const BACKUP_FORMAT = "readany-library-backup";

/** Bumped only when the file layout changes in a way older apps cannot read. */
export const BACKUP_VERSION = 1;

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  /** Unix ms the backup was taken. */
  createdAt: number;
  /** The device it was taken on, so a restore can say where the file came from. */
  deviceId: string;
  appVersion?: string;
  /** Row counts per table, so the file can be described to the user before it is applied. */
  counts: Record<string, number>;
  /** Total rows across every table. */
  totalRecords: number;
}

export interface LibraryBackup {
  manifest: BackupManifest;
  snapshot: DeviceSyncPayload;
  /** Settings that live outside SQLite. Absent in files made before this existed. */
  settings?: BackupSettings;
}

/** What a backup file claims to contain, safe to show before restoring it. */
export interface BackupSummary {
  createdAt: number;
  deviceId: string;
  appVersion?: string;
  counts: Record<string, number>;
  totalRecords: number;
  /**
   * Tables present in the file that this build does not know how to restore.
   * Non-empty means the file came from a newer app and some of it will be
   * dropped — the caller should say so rather than restore in silence.
   */
  unreadableTables: string[];
  /** What the settings section holds, or null when the file has none. */
  settings: BackupSettingsSummary | null;
}

/**
 * Take a full snapshot of the local library.
 *
 * `collectChanges(0)` — since the beginning of time — is what the sync engine
 * itself uses to seed a device that has never synced, so this is a known-good
 * path rather than a bespoke query.
 */
export async function createLibraryBackup(
  options: { appVersion?: string; settings?: BackupSettings } = {},
): Promise<LibraryBackup> {
  const snapshot = await collectChanges(0);

  const counts: Record<string, number> = {};
  let totalRecords = 0;
  for (const [table, changeset] of Object.entries(snapshot.tables)) {
    counts[table] = changeset.records.length;
    totalRecords += changeset.records.length;
  }

  return {
    manifest: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: Date.now(),
      deviceId: snapshot.deviceId,
      ...(options.appVersion ? { appVersion: options.appVersion } : {}),
      counts,
      totalRecords,
    },
    snapshot,
    ...(options.settings ? { settings: options.settings } : {}),
  };
}

export function serializeBackup(backup: LibraryBackup): string {
  return JSON.stringify(backup);
}

function isChangeset(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const changeset = value as { records?: unknown; deletedIds?: unknown };
  return Array.isArray(changeset.records) && Array.isArray(changeset.deletedIds);
}

/**
 * Structural check only — it says "this is one of our backup files", not
 * "this file is safe to apply". Version compatibility is checked separately at
 * restore time so the caller can explain the refusal.
 */
export function isLibraryBackup(value: unknown): value is LibraryBackup {
  if (typeof value !== "object" || value === null) return false;
  const backup = value as Partial<LibraryBackup>;

  const manifest = backup.manifest;
  if (typeof manifest !== "object" || manifest === null) return false;
  if (manifest.format !== BACKUP_FORMAT) return false;
  if (typeof manifest.version !== "number" || !Number.isFinite(manifest.version)) return false;

  const snapshot = backup.snapshot;
  if (typeof snapshot !== "object" || snapshot === null) return false;
  if (typeof snapshot.tables !== "object" || snapshot.tables === null) return false;

  // Absent is fine — older files have none. Present but malformed is not: it
  // would be read as settings and applied.
  if (backup.settings !== undefined && !isBackupSettings(backup.settings)) return false;

  return Object.values(snapshot.tables).every(isChangeset);
}

/** Parse a file's text. Returns null for anything that is not one of our backups. */
export function parseBackup(raw: string): LibraryBackup | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  return isLibraryBackup(data) ? data : null;
}

/**
 * Describe a backup without touching the database, so the user can be shown
 * what they are about to restore — and warned about anything this build cannot
 * read — before they commit to it.
 */
export function describeBackup(backup: LibraryBackup): BackupSummary {
  const known = new Set<string>(SYNC_TABLE_NAMES);
  const unreadableTables = Object.entries(backup.snapshot.tables)
    .filter(([table, changeset]) => !known.has(table) && changeset.records.length > 0)
    .map(([table]) => table);

  return {
    createdAt: backup.manifest.createdAt,
    deviceId: backup.manifest.deviceId,
    ...(backup.manifest.appVersion ? { appVersion: backup.manifest.appVersion } : {}),
    counts: backup.manifest.counts ?? {},
    totalRecords: backup.manifest.totalRecords ?? 0,
    unreadableTables,
    settings: describeBackupSettings(backup.settings),
  };
}

/**
 * Write a backup's records into the local database.
 *
 * `forceApply` is deliberate. The ordinary merge rule keeps whichever row has
 * the newer `updated_at`, which is right for two live devices reconciling — but
 * a restore is not a reconciliation. The reason to reach for a backup is that
 * the local state is wrong, and wrong state is often *newer* than the good copy
 * in the file. Without forceApply the restore would look like it worked and
 * change nothing.
 *
 * Tables in the file that this build does not know are ignored by
 * `applyChanges`; `describeBackup` reports them so that loss is never silent.
 */
export async function restoreLibraryBackup(
  backup: LibraryBackup,
): Promise<{ applied: number; skipped: number }> {
  if (backup.manifest.version > BACKUP_VERSION) {
    throw new Error(
      `This backup was made by a newer version of ReadAny (format ${backup.manifest.version}, this build reads ${BACKUP_VERSION}). Update the app, then restore.`,
    );
  }

  return applyChanges(backup.snapshot, { forceApply: true });
}
