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
  const { Uint8ArrayReader, ZipReader, TextWriter } = await import("@zip.js/zip.js");
  const { File } = await import("expo-file-system");

  // Read the archive straight into bytes. The obvious route — base64 then
  // atob — does not work: this React Native has no atob, which surfaces as
  // "undefined is not a function" a long way from the cause.
  const bytes = await new File(fileUri).bytes();

  // Uint8ArrayReader, not BlobReader: React Native's Blob cannot be built from
  // an array buffer, and fails with "creating blob from array buffer" — which
  // is a platform limitation, not a bad archive.
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const entries = await reader.getEntries();

  // zip.js types getData only on the union member that has it; a directory
  // entry does not. Read through a narrow helper rather than casting at
  // every call site.
  const readText = async (entry: (typeof entries)[number]): Promise<string | null> => {
    const getData = (entry as { getData?: (writer: unknown) => Promise<string> }).getData;
    return getData ? await getData.call(entry, new TextWriter()) : null;
  };

  const indexEntry = entries.find((e) => e.filename.endsWith("index.json"));
  const indexText = indexEntry ? await readText(indexEntry) : null;
  if (!indexText) throw new Error("Not a Yomitan dictionary: no index.json");
  const index = JSON.parse(indexText) as {
    title?: string; revision?: string;
  };
  const title = index.title?.trim() || "Untitled dictionary";
  const revision = index.revision ?? "";

  const banks = entries
    .filter((e) => /term_bank_\d+\.json$/.test(e.filename))
    .sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
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
    const bankText = await readText(banks[i]);
    if (!bankText) continue;
    const terms = JSON.parse(bankText) as TermRow[];

    // One transaction per bank: a whole-file transaction risks losing a long
    // import to one malformed entry, and per-row commits are far too slow.
    // The statement is prepared once — JMdict is a quarter of a million rows,
    // and re-parsing the SQL for each one dominates the import otherwise.
    const insert = await db.prepareAsync(
      "INSERT INTO terms (dictionary_id, expression, reading, rules, score, glossary) VALUES (?, ?, ?, ?, ?, ?)",
    );
    try {
      await db.withTransactionAsync(async () => {
        for (const term of terms) {
          if (!Array.isArray(term) || typeof term[0] !== "string") continue;
          const text = glossaryToText(term[5]);
          if (!text) continue;
          await insert.executeAsync(
            dictId, term[0], term[1] ?? "", term[3] ?? "", Number(term[4]) || 0, text,
          );
          termCount += 1;
        }
      });
    } finally {
      await insert.finalizeAsync();
    }
    onProgress?.(i + 1, banks.length, title);
  }

  await reader.close();
  await db.runAsync("UPDATE dictionaries SET term_count = ? WHERE id = ?", termCount, dictId);
  return { id: dictId, title, revision, termCount, importedAt: Date.now() };
}
