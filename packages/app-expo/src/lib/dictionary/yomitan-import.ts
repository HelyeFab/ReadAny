/**
 * Import a Yomitan dictionary archive.
 *
 * Yomitan (and Yomichan before it) ships dictionaries as a ZIP containing an
 * index.json plus numbered term_bank_N.json files. Each term is a fixed-shape
 * array rather than an object:
 *
 *   [expression, reading, definitionTags, rules, score, glossary, sequence, termTags]
 *
 * `rules` is the part that matters for Japanese lookup: it names the inflection
 * class (v1, v5, adj-i …), which is what lets 育てられた be resolved back to
 * 育てる rather than missing entirely.
 *
 * Terms go into their own SQLite database so importing or deleting a dictionary
 * can never touch the library.
 */
import * as SQLite from "expo-sqlite";

const DB_NAME = "readany-dict.db";

export interface DictionaryInfo {
  id: number;
  title: string;
  revision: string;
  termCount: number;
  importedAt: number;
}

type TermRow = [
  string, // expression
  string, // reading
  string | null, // definitionTags
  string, // rules
  number, // score
  unknown, // glossary
  number, // sequence
  string, // termTags
];

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDictDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS dictionaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE,
      revision TEXT,
      term_count INTEGER NOT NULL DEFAULT 0,
      imported_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS terms (
      dictionary_id INTEGER NOT NULL,
      expression TEXT NOT NULL,
      reading TEXT,
      rules TEXT,
      score INTEGER NOT NULL DEFAULT 0,
      glossary TEXT NOT NULL,
      FOREIGN KEY (dictionary_id) REFERENCES dictionaries(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_terms_expression ON terms(expression);
    CREATE INDEX IF NOT EXISTS idx_terms_reading ON terms(reading);
  `);
  _db = db;
  return db;
}

/** Glossary entries may be plain strings or structured content; keep text. */
function glossaryToText(glossary: unknown): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (node && typeof node === "object") {
      const rec = node as Record<string, unknown>;
      if (typeof rec.text === "string") out.push(rec.text);
      if (rec.content !== undefined) walk(rec.content);
    }
  };
  walk(glossary);
  return out.join("\n").trim();
}

export async function listDictionaries(): Promise<DictionaryInfo[]> {
  const db = await getDictDb();
  const rows = await db.getAllAsync<{
    id: number; title: string; revision: string | null;
    term_count: number; imported_at: number;
  }>("SELECT id, title, revision, term_count, imported_at FROM dictionaries ORDER BY title");
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    revision: r.revision ?? "",
    termCount: r.term_count,
    importedAt: r.imported_at,
  }));
}

export async function deleteDictionary(id: number): Promise<void> {
  const db = await getDictDb();
  await db.runAsync("DELETE FROM terms WHERE dictionary_id = ?", id);
  await db.runAsync("DELETE FROM dictionaries WHERE id = ?", id);
}

/**
 * Read a Yomitan zip and store its terms.
 * `onProgress` reports banks completed out of banks found.
 */
export async function importYomitanZip(
  fileUri: string,
  onProgress?: (done: number, total: number, title: string) => void,
): Promise<DictionaryInfo> {
  // fflate, not zip.js: zip.js is built on the browser Streams API, which
  // React Native does not provide, so it fails with "undefined is not a
  // function" nowhere near the call. fflate is plain JS with no platform
  // dependencies and unzips straight from bytes.
  const { unzipSync, strFromU8 } = await import("fflate");
  const { File } = await import("expo-file-system");

  // Read the archive straight into bytes. The obvious route — base64 then
  // atob — does not work either: this React Native has no atob.
  const bytes = await new File(fileUri).bytes();
  const files = unzipSync(bytes);

  const readText = (name: string): string | null => {
    const data = files[name];
    return data ? strFromU8(data) : null;
  };

  const names = Object.keys(files);
  const indexName = names.find((n) => n.endsWith("index.json"));
  const indexText = indexName ? readText(indexName) : null;
  if (!indexText) throw new Error("Not a Yomitan dictionary: no index.json");
  const index = JSON.parse(indexText) as {
    title?: string; revision?: string;
  };
  const title = index.title?.trim() || "Untitled dictionary";
  const revision = index.revision ?? "";

  const banks = names
    .filter((n) => /term_bank_\d+\.json$/.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (banks.length === 0) throw new Error("Not a Yomitan dictionary: no term banks");

  const db = await getDictDb();
  await db.runAsync("DELETE FROM terms WHERE dictionary_id IN (SELECT id FROM dictionaries WHERE title = ?)", title);
  await db.runAsync("DELETE FROM dictionaries WHERE title = ?", title);
  await db.runAsync(
    "INSERT INTO dictionaries (title, revision, term_count, imported_at) VALUES (?, ?, 0, ?)",
    title, revision, Date.now(),
  );
  const dictId = (await db.getFirstAsync<{ id: number }>(
    "SELECT id FROM dictionaries WHERE title = ?", title,
  ))?.id;
  if (dictId === undefined) throw new Error("Could not record the dictionary");

  let termCount = 0;
  for (let i = 0; i < banks.length; i += 1) {
    const bankText = readText(banks[i]);
    if (!bankText) continue;
    const terms = JSON.parse(bankText) as TermRow[];

    // One transaction per bank: a whole-file transaction risks losing a long
    // import to one malformed entry, and per-row commits are far too slow.
    // Rows go in batched, because JMdict English is over half a million of
    // them and each statement is a round trip across the native bridge.
    const rows: (string | number)[] = [];
    let pending = 0;

    const flush = async () => {
      if (pending === 0) return;
      const values = Array.from({ length: pending }, () => "(?, ?, ?, ?, ?, ?)").join(", ");
      await db.runAsync(
        `INSERT INTO terms (dictionary_id, expression, reading, rules, score, glossary) VALUES ${values}`,
        ...rows,
      );
      rows.length = 0;
      pending = 0;
    };

    await db.withTransactionAsync(async () => {
      for (const term of terms) {
        if (!Array.isArray(term) || typeof term[0] !== "string") continue;
        const text = glossaryToText(term[5]);
        if (!text) continue;
        rows.push(dictId, term[0], term[1] ?? "", term[3] ?? "", Number(term[4]) || 0, text);
        pending += 1;
        termCount += 1;
        // SQLite's default variable limit is 999, so 6 columns caps a batch
        // at 166 rows. 150 leaves headroom.
        if (pending >= 150) await flush();
      }
      await flush();
    });
    onProgress?.(i + 1, banks.length, title);
  }

  await db.runAsync("UPDATE dictionaries SET term_count = ? WHERE id = ?", termCount, dictId);
  return { id: dictId, title, revision, termCount, importedAt: Date.now() };
}
