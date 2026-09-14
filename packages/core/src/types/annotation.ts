/** Annotation types: highlights, notes, bookmarks */

// Predefined highlight colors (matching readest)
export type HighlightColor = "red" | "yellow" | "green" | "blue" | "pink" | "purple" | "violet";

// Hex color values for each highlight color
/**
 * Highlighter-pen colours, not palette colours.
 *
 * These were Tailwind's 400 shades — pastels, designed to sit politely behind
 * text on a bright LCD. On a colour e-ink panel, whose filter array cuts
 * saturation hard before anything reaches the eye, a pastel arrives as grey.
 * These are the saturated, fluorescent end instead: what survives that filter
 * is what a real highlighter looks like on paper.
 */
export const HIGHLIGHT_COLOR_HEX: Record<HighlightColor, string> = {
  red: "#ff3b30",
  yellow: "#ffe800",
  green: "#00e676",
  blue: "#00b0ff",
  pink: "#ff2d95",
  purple: "#a93bff",
  violet: "#7c4dff",
};

// All available highlight colors in display order
export const HIGHLIGHT_COLORS: HighlightColor[] = ["yellow", "green", "blue", "pink", "purple"];

export interface Highlight {
  id: string;
  bookId: string;
  cfi: string; // EPUB CFI range
  text: string;
  color: HighlightColor;
  note?: string;
  chapterTitle?: string;
  createdAt: number;
  updatedAt: number;
}

export interface Note {
  id: string;
  bookId: string;
  highlightId?: string; // optional link to highlight
  cfi?: string;
  title: string;
  content: string; // markdown
  chapterTitle?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  cfi: string;
  label?: string;
  chapterTitle?: string;
  createdAt: number;
}

export type Annotation = Highlight | Note | Bookmark;
