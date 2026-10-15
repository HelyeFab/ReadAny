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
import { foldTerm } from "./fold";

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
  await addFoldedColumn(db);
  _db = db;
  return db;
}

/**
 * Databases created before folded matching existed lack the column. SQLite's
 * lower() only knows ASCII, which is exactly right for what was installed by
 * then — Japanese, which folding leaves alone, and WordNet English. Anything
 * imported from now on is folded properly in JS.
 */
async function addFoldedColumn(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>("PRAGMA table_info(terms)");
  if (!columns.some((c) => c.name === "folded")) {
    await db.execAsync(`
      ALTER TABLE terms ADD COLUMN folded TEXT;
      UPDATE terms SET folded = lower(expression);
    `);
  }
  await db.execAsync("CREATE INDEX IF NOT EXISTS idx_terms_folded ON terms(folded);");
}

/** One term as every importer hands it to the store. */
export interface TermInput {
  expression: string;
  reading: string;
  rules: string;
  score: number;
  glossary: string;
}

/**
 * Register a dictionary, replacing any earlier import with the same title,
 * and return its id.
 */
export async function createDictionary(title: string, revision: string): Promise<number> {
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
  return dictId;
}

export async function setTermCount(dictId: number, termCount: number): Promise<void> {
  const db = await getDictDb();
  await db.runAsync("UPDATE dictionaries SET term_count = ? WHERE id = ?", termCount, dictId);
}

/**
 * Write one chunk of terms in a single transaction and return how many went in.
 *
 * One transaction per chunk: a whole-file transaction risks losing a long
 * import to one malformed entry, and per-row commits are far too slow. Rows go
 * in batched, because JMdict English is over half a million of them and each
 * statement is a round trip across the native bridge.
 */
export async function insertTerms(dictId: number, terms: Iterable<TermInput>): Promise<number> {
  const db = await getDictDb();
  const rows: (string | number)[] = [];
  let pending = 0;
  let written = 0;

  const flush = async () => {
    if (pending === 0) return;
    const values = Array.from({ length: pending }, () => "(?, ?, ?, ?, ?, ?, ?)").join(", ");
    await db.runAsync(
      `INSERT INTO terms (dictionary_id, expression, reading, rules, score, glossary, folded) VALUES ${values}`,
      ...rows,
    );
    rows.length = 0;
    pending = 0;
  };

  await db.withTransactionAsync(async () => {
    for (const term of terms) {
      if (!term.expression || !term.glossary) continue;
      rows.push(
        dictId, term.expression, term.reading, term.rules, term.score, term.glossary,
        foldTerm(term.expression),
      );
      pending += 1;
      written += 1;
      // SQLite's default variable limit is 999, so 7 columns caps a batch at
      // 142 rows. 120 leaves headroom.
      if (pending >= 120) await flush();
    }
    await flush();
  });
  return written;
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

/** True when these unpacked files are a Yomitan dictionary. */
export function isYomitan(files: Record<string, Uint8Array>): boolean {
  return Object.keys(files).some((n) => /(^|\/)index\.json$/.test(n));
}

/**
 * Store the terms of an unpacked Yomitan archive.
 * `onProgress` reports banks completed out of banks found.
 */
export async function importYomitanFiles(
  files: Record<string, Uint8Array>,
  onProgress?: (done: number, total: number, title: string) => void,
): Promise<DictionaryInfo> {
  const { strFromU8 } = await import("fflate");

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

  const dictId = await createDictionary(title, revision);

  let termCount = 0;
  for (let i = 0; i < banks.length; i += 1) {
    const bankText = readText(banks[i]);
    if (!bankText) continue;
    const terms = JSON.parse(bankText) as TermRow[];
    termCount += await insertTerms(dictId, yomitanTerms(terms));
    onProgress?.(i + 1, banks.length, title);
  }

  await setTermCount(dictId, termCount);
  return { id: dictId, title, revision, termCount, importedAt: Date.now() };
}

function* yomitanTerms(terms: TermRow[]): Generator<TermInput> {
  for (const term of terms) {
    if (!Array.isArray(term) || typeof term[0] !== "string") continue;
    yield {
      expression: term[0],
      reading: term[1] ?? "",
      rules: term[3] ?? "",
      score: Number(term[4]) || 0,
      glossary: glossaryToText(term[5]),
    };
  }
}
