import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SYNC_TABLE_NAMES } from "../simple-sync";

const root = resolve(import.meta.dirname, "../../../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

/**
 * The Web tab could not sync for its whole life because its pages were kept
 * outside the database, and nothing anywhere said that was a decision with a
 * consequence. These tests state the rule: a table that sync carries must
 * actually exist, and must carry the columns sync needs to carry it.
 */
describe("sync table contract", () => {
  const schema = read("packages/core/src/db/db-core.ts");

  it("every synced table is created in the schema", () => {
    for (const table of SYNC_TABLE_NAMES) {
      expect(schema).toContain(`CREATE TABLE IF NOT EXISTS ${table} `);
    }
  });

  it("every synced table gets the sync bookkeeping columns", () => {
    // The guarded-ALTER list in initDatabase is what reaches an existing
    // database; a table missing from it fails far away, as "no such column".
    const alterList = schema.slice(
      schema.indexOf("Migration 7: Add sync_version"),
      schema.indexOf("Migration 8:"),
    );
    for (const table of SYNC_TABLE_NAMES) {
      expect(alterList).toContain(`"${table}"`);
    }
  });

  it("carries the Web tab's pages", () => {
    // Regression: saved pages lived in device-local zustand storage and so
    // could never reach another device.
    expect(SYNC_TABLE_NAMES).toContain("web_pages");
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS web_pages[\s\S]*?updated_at INTEGER/);
  });

  it("keeps web pages out of the device-local store", () => {
    const store = read("packages/app-expo/src/stores/web-store.ts");
    // The store may still read the old persisted lists to migrate them, but it
    // must not be the place pages live.
    expect(store).toContain("@readany/core/db");
    expect(store).toMatch(/_legacy(Recent|Saved)/);
  });
});
