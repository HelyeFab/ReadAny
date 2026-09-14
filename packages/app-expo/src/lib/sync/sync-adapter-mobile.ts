/**
 * Mobile (Expo) sync adapter — implements ISyncAdapter
 * using expo-sqlite and expo-file-system.
 */
import { hashFileAtPath } from "@/lib/file-hash";
import { closeDB, initDatabase, resetDBCache, resetLocalDBCache } from "@readany/core/db";
import type { ISyncAdapter } from "@readany/core/sync";
import Constants from "expo-constants";
import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

const MAX_MOBILE_BUFFERED_TRANSFER_BYTES = 16 * 1024 * 1024;

export class MobileSyncAdapter implements ISyncAdapter {
  readonly maxBufferedTransferBytes = MAX_MOBILE_BUFFERED_TRANSFER_BYTES;

  async vacuumInto(targetPath: string): Promise<void> {
    const SQLite = await import("expo-sqlite");
    const db = await SQLite.openDatabaseAsync("readany.db");
    const targetDirPath = targetPath.replace(/\/[^/]+$/, "");
    const targetDir = new Directory(targetDirPath);
    if (!targetDir.exists) {
      targetDir.create({ intermediates: true });
    }

    // expo-sqlite expects a native filesystem path here, not a file:// URI.
    const sqliteTargetPath = targetPath.replace(/^file:\/\//, "");
    try {
      await db.execAsync(`VACUUM INTO '${sqliteTargetPath.replace(/'/g, "''")}'`);
    } finally {
      await db.closeAsync();
    }
  }

  async integrityCheck(dbPath: string): Promise<boolean> {
    const SQLite = await import("expo-sqlite");
    // expo-sqlite needs a db name relative to the documents directory
    // For a temp file, we open by copying approach or use raw path
    // Since integrity check needs to open an arbitrary path, we use a workaround:
    // Copy the file to a known name, open it, check, then clean up
    const tempName = `_integrity_check_${Date.now()}.db`;
    const srcFile = new File(dbPath);
    const destFile = new File(Paths.document, tempName);

    try {
      srcFile.copy(destFile);
      const db = await SQLite.openDatabaseAsync(tempName);
      try {
        const result = await db.getFirstAsync<{ integrity_check: string }>(
          "PRAGMA integrity_check",
        );
        return result?.integrity_check === "ok";
      } finally {
        await db.closeAsync();
      }
    } finally {
      if (destFile.exists) {
        destFile.delete();
      }
    }
  }

  async closeDatabase(): Promise<void> {
    await closeDB();
  }

  async reopenDatabase(): Promise<void> {
    resetDBCache();
    resetLocalDBCache();
    await initDatabase();
  }

  async getDatabasePath(): Promise<string> {
    // expo-sqlite stores databases in the document directory
    const docUri = Paths.document.uri;
    return `${docUri}/SQLite/readany.db`;
  }

  async getTempDir(): Promise<string> {
    return Paths.cache.uri;
  }

  async getAppDataDir(): Promise<string> {
    return Paths.document.uri;
  }

  /**
   * SHA-256 over the file's raw bytes, as lowercase hex — the same string the
   * desktop's `sync_hash_file` produces.
   *
   * ⚠️ This used to hash `arrayBufferToBase64(data)`, which digests the base64
   * TEXT rather than the bytes it encodes. Mobile devices agreed with each
   * other, so nothing looked broken, but no mobile hash could ever equal a
   * desktop one for the same file — and these hashes are what decide whether a
   * cover already on the server is the cover we hold, so every desktop/mobile
   * switch re-uploaded covers that had not changed.
   *
   * Streamed rather than buffered: `file.bytes()` pulls the whole file into
   * memory, which is affordable for a cover and not for a book.
   */
  async hashFile(filePath: string): Promise<string> {
    return hashFileAtPath(filePath);
  }

  async readFileBytes(filePath: string): Promise<Uint8Array> {
    const file = new File(filePath);
    return file.bytes();
  }

  async readFileRange(filePath: string, offset: number, length: number): Promise<Uint8Array> {
    const handle = new File(filePath).open();
    try {
      handle.offset = offset;
      return handle.readBytes(length);
    } finally {
      handle.close();
    }
  }

  async getFileSize(filePath: string): Promise<number | null> {
    try {
      const file = new File(filePath);
      return file.exists && Number.isFinite(file.size) ? file.size : null;
    } catch {
      return null;
    }
  }

  async writeFileBytes(filePath: string, data: Uint8Array): Promise<void> {
    const file = new File(filePath);
    file.write(data);
  }

  async copyFile(src: string, dest: string): Promise<void> {
    const srcFile = new File(src);
    const destFile = new File(dest);
    // Delete destination if it exists (copy doesn't overwrite)
    if (destFile.exists) {
      destFile.delete();
    }
    srcFile.copy(destFile);
  }

  async deleteFile(filePath: string): Promise<void> {
    const file = new File(filePath);
    if (file.exists) {
      file.delete();
    }
  }

  async fileExists(filePath: string): Promise<boolean> {
    const info = Paths.info(filePath);
    return info.exists;
  }

  async listFiles(dirPath: string): Promise<string[]> {
    try {
      const dir = new Directory(dirPath);
      if (!dir.exists) return [];
      const entries = dir.list();
      return entries.filter((e) => e instanceof File).map((e) => e.name);
    } catch {
      return [];
    }
  }

  async ensureDir(dirPath: string): Promise<void> {
    const dir = new Directory(dirPath);
    if (!dir.exists) {
      dir.create({ intermediates: true });
    }
  }

  joinPath(...segments: string[]): string {
    const joined = segments.join("/");
    // Preserve file:// protocol prefix while collapsing duplicate slashes
    const match = joined.match(/^(file:\/\/)(\/.*)/);
    if (match) {
      return match[1] + match[2].replace(/\/+/g, "/");
    }
    return joined.replace(/\/+/g, "/");
  }

  async getAppVersion(): Promise<string> {
    return Constants.expoConfig?.version ?? "1.0.0";
  }

  async getDeviceName(): Promise<string> {
    return `${Platform.OS}-${Constants.deviceName || "mobile"}`;
  }
}
