/**
 * Folder colours — the same seven hues as the tinted reading themes, so a
 * coloured folder and a coloured page look like the same product rather than
 * two unrelated palettes.
 */
export interface FolderColor {
  id: string;
  labelKey: string;
  fallback: string;
  /** Tile background: light enough that a cover and the title stay readable. */
  tint: string;
  /** Folder glyph and accents. */
  accent: string;
}

export const FOLDER_COLORS: FolderColor[] = [
  { id: "apricot", labelKey: "settings.apricot", fallback: "Apricot", tint: "#fbe6d6", accent: "#a35a1f" },
  { id: "coral", labelKey: "settings.coral", fallback: "Coral", tint: "#fbdcdd", accent: "#a3363c" },
  { id: "rose", labelKey: "settings.rose", fallback: "Rose", tint: "#f4dde6", accent: "#8c3358" },
  { id: "sage", labelKey: "settings.sage", fallback: "Sage", tint: "#e4ead8", accent: "#5a6b3c" },
  { id: "jade", labelKey: "settings.jade", fallback: "Jade", tint: "#d9ece3", accent: "#2c6b52" },
  { id: "teal", labelKey: "settings.teal", fallback: "Teal", tint: "#d4eae8", accent: "#116460" },
  { id: "indigo", labelKey: "settings.indigo", fallback: "Deep Blue", tint: "#d6e4ee", accent: "#0f4a6e" },
];

export function folderColor(id?: string): FolderColor | undefined {
  return id ? FOLDER_COLORS.find((c) => c.id === id) : undefined;
}
