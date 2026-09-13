/**
 * Remembered export choices.
 *
 * Filing highlights is a decision you make once and then repeat for years:
 * the same folder, the same scheme, the same format. Asking again every time
 * would turn a one-tap habit into a form, so the last answer is kept and the
 * sheet opens on it.
 */
import { getPlatformService } from "../services/platform";
import type { ExportFormat } from "./annotation-exporter";
import {
  DEFAULT_FILING,
  FOLDER_SCHEMES,
  type FilingOptions,
  type FolderScheme,
} from "./highlight-filing";

export const HIGHLIGHT_EXPORT_PREFS_KEY = "highlight_export_prefs";

export type ExportScope = "book" | "all";

export interface HighlightExportPrefs extends FilingOptions {
  /** This book, or every book with highlights in one file. */
  scope: ExportScope;
  /** What to do when the name is taken. */
  conflict: "keepBoth" | "overwrite";
}

export const DEFAULT_EXPORT_PREFS: HighlightExportPrefs = {
  ...DEFAULT_FILING,
  scope: "book",
  conflict: "keepBoth",
};

const FORMATS: ExportFormat[] = ["markdown", "obsidian", "json", "notion"];

/** Accept only values this build understands; anything else falls back. */
function coerce(raw: unknown): HighlightExportPrefs {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_EXPORT_PREFS };
  const value = raw as Partial<HighlightExportPrefs>;
  return {
    baseFolder:
      typeof value.baseFolder === "string" && value.baseFolder.trim()
        ? value.baseFolder
        : DEFAULT_EXPORT_PREFS.baseFolder,
    scheme: FOLDER_SCHEMES.includes(value.scheme as FolderScheme)
      ? (value.scheme as FolderScheme)
      : DEFAULT_EXPORT_PREFS.scheme,
    filenameTemplate:
      typeof value.filenameTemplate === "string" && value.filenameTemplate.trim()
        ? value.filenameTemplate
        : DEFAULT_EXPORT_PREFS.filenameTemplate,
    format: FORMATS.includes(value.format as ExportFormat)
      ? (value.format as ExportFormat)
      : DEFAULT_EXPORT_PREFS.format,
    scope: value.scope === "all" ? "all" : "book",
    conflict: value.conflict === "overwrite" ? "overwrite" : "keepBoth",
  };
}

export async function loadHighlightExportPrefs(): Promise<HighlightExportPrefs> {
  try {
    const raw = await getPlatformService().kvGetItem(HIGHLIGHT_EXPORT_PREFS_KEY);
    if (!raw) return { ...DEFAULT_EXPORT_PREFS };
    return coerce(JSON.parse(raw));
  } catch (error) {
    console.warn("[Export] Ignoring unreadable export preferences:", error);
    return { ...DEFAULT_EXPORT_PREFS };
  }
}

export async function saveHighlightExportPrefs(prefs: HighlightExportPrefs): Promise<void> {
  try {
    await getPlatformService().kvSetItem(HIGHLIGHT_EXPORT_PREFS_KEY, JSON.stringify(coerce(prefs)));
  } catch (error) {
    // Losing the preference is a nuisance, not a failure of the export itself.
    console.warn("[Export] Failed to remember export preferences:", error);
  }
}
