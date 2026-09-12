import type { BookGroup } from "../types";
import { generateId } from "../utils/generate-id";
import { getDB, getDeviceId, insertTombstone, nextSyncVersion, nextUpdatedAt } from "./db-core";

interface BookGroupRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  view_prefs: string | null;
  sort_order: number | null;
  created_at: number;
  updated_at: number;
}

/** Stored as JSON; a corrupt value must not take the whole library down. */
function parseViewPrefs(raw: string | null): BookGroup["viewPrefs"] {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as BookGroup["viewPrefs"];
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function rowToBookGroup(row: BookGroupRow): BookGroup {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parent_id ?? undefined,
    color: row.color ?? undefined,
    viewPrefs: parseViewPrefs(row.view_prefs),
    sortOrder: row.sort_order ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function getGroups(): Promise<BookGroup[]> {
  const database = await getDB();
  const rows = await database.select<BookGroupRow>(
    "SELECT * FROM book_groups ORDER BY sort_order ASC, created_at ASC",
  );
  return rows.map(rowToBookGroup);
}

export async function insertGroup(input: {
  id?: string;
  name: string;
  parentId?: string;
  sortOrder?: number;
}): Promise<BookGroup> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const syncVersion = await nextSyncVersion(database, "book_groups");
  const now = Date.now();
  const group: BookGroup = {
    id: input.id ?? generateId(),
    name: input.name.trim(),
    parentId: input.parentId,
    sortOrder: input.sortOrder ?? now,
    createdAt: now,
    updatedAt: now,
  };

  await database.execute(
    `INSERT INTO book_groups (id, name, parent_id, sort_order, created_at, updated_at, sync_version, last_modified_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      group.id,
      group.name,
      group.parentId ?? null,
      group.sortOrder,
      group.createdAt,
      group.updatedAt,
      syncVersion,
      deviceId,
    ],
  );

  return group;
}

export async function updateGroup(
  id: string,
  updates: Partial<Pick<BookGroup, "name" | "sortOrder" | "parentId" | "color" | "viewPrefs">>,
): Promise<void> {
  const database = await getDB();
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name.trim());
  }
  if (updates.sortOrder !== undefined) {
    sets.push("sort_order = ?");
    values.push(updates.sortOrder);
  }
  if (updates.parentId !== undefined) {
    sets.push("parent_id = ?");
    values.push(updates.parentId || null);
  }
  if (updates.color !== undefined) {
    sets.push("color = ?");
    values.push(updates.color || null);
  }
  if (updates.viewPrefs !== undefined) {
    sets.push("view_prefs = ?");
    values.push(updates.viewPrefs ? JSON.stringify(updates.viewPrefs) : null);
  }
  if (sets.length === 0) return;

  const deviceId = await getDeviceId();
  const updatedAt = await nextUpdatedAt(database, "book_groups", id);
  const syncVersion = await nextSyncVersion(database, "book_groups");
  sets.push("updated_at = ?");
  values.push(updatedAt);
  sets.push("sync_version = ?");
  values.push(syncVersion);
  sets.push("last_modified_by = ?");
  values.push(deviceId);
  values.push(id);

  await database.execute(`UPDATE book_groups SET ${sets.join(", ")} WHERE id = ?`, values);
}

export async function deleteGroup(id: string): Promise<void> {
  const database = await getDB();
  const deviceId = await getDeviceId();
  const updatedAt = Date.now();
  const bookSyncVersion = await nextSyncVersion(database, "books");

  await database.execute(
    `UPDATE books
     SET group_id = NULL, updated_at = ?, sync_version = ?, last_modified_by = ?
     WHERE group_id = ?`,
    [updatedAt, bookSyncVersion, deviceId, id],
  );
  // Children are lifted to this folder's parent rather than orphaned: a
  // subfolder whose parent no longer exists would vanish from every view.
  const parentRow = await database.select<{ parent_id: string | null }>(
    "SELECT parent_id FROM book_groups WHERE id = ?",
    [id],
  );
  const newParent = parentRow[0]?.parent_id ?? null;
  const groupSyncVersion = await nextSyncVersion(database, "book_groups");
  await database.execute(
    `UPDATE book_groups
     SET parent_id = ?, updated_at = ?, sync_version = ?, last_modified_by = ?
     WHERE parent_id = ?`,
    [newParent, updatedAt, groupSyncVersion, deviceId, id],
  );

  await insertTombstone(database, id, "book_groups");
  await database.execute("DELETE FROM book_groups WHERE id = ?", [id]);
}
