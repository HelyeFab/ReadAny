/**
 * Which folders a shelf scope actually covers.
 *
 * Pure and free of React Native, so it can be reasoned about — and tested —
 * without a device.
 */

/**
 * Expand chosen folders to include everything nested inside them. Picking a
 * folder means picking what it contains, and a folder of folders would
 * otherwise come back empty — which is exactly how the library's own folder
 * tiles ended up drawing "211 books" as an empty folder.
 */
export function expandFolderIds(
  groupIds: string[],
  groups: { id: string; parentId?: string | null }[],
): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const group of groups) {
    const parent = group.parentId ?? "";
    if (!parent) continue;
    childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), group.id]);
  }

  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return; // also guards a cycle in the folder tree
    out.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child);
  };
  for (const id of groupIds) walk(id);
  return out;
}
