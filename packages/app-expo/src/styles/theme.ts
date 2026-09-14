/**
 * Theme constants — re-exports dark colors as default for backward compat.
 * Use `useTheme()` from ThemeContext for reactive theme colors.
 */
import { Dimensions } from "react-native";
import { darkColors, useTheme } from "./ThemeContext";
import { classifyViewport, scaleFont, typeScaleFor } from "./viewport";
export type { ThemeColors } from "./ThemeContext";
export { useTheme } from "./ThemeContext";

/**
 * Convert a hex color to an rgba string with the given opacity.
 * Accepts 3-digit (#abc) or 6-digit (#aabbcc) hex values.
 */
export function withOpacity(hex: string, opacity: number): string {
  let r: number, g: number, b: number;
  const h = hex.replace("#", "");
  if (h.length === 3) {
    r = Number.parseInt(h[0] + h[0], 16);
    g = Number.parseInt(h[1] + h[1], 16);
    b = Number.parseInt(h[2] + h[2], 16);
  } else {
    r = Number.parseInt(h.slice(0, 2), 16);
    g = Number.parseInt(h.slice(2, 4), 16);
    b = Number.parseInt(h.slice(4, 6), 16);
  }
  return `rgba(${r},${g},${b},${opacity})`;
}

/** @deprecated Use useColors() instead for theme-aware components */
export const colors = darkColors;

/**
 * Hook to get current theme colors. Use this in component function bodies
 * so the local `colors` variable shadows the static import, making
 * StyleSheet.create fallback to dark while inline styles use the real theme.
 */
export function useColors() {
  return useTheme().colors;
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  xxl: 16,
  full: 9999,
} as const;

/**
 * The type scale as designed, at phone size. Exported so tests and any future
 * size preference have the unscaled numbers to work from.
 */
export const baseFontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  md: 18,
  lg: 20,
  xl: 22,
  "2xl": 26,
  "3xl": 30,
} as const;

/**
 * How much this device's text is scaled up from the phone design — 1 on a
 * phone, larger on tablets. See `typeScaleFor` for why this exists at all.
 *
 * Read once at module load rather than through a hook, because almost every
 * screen puts these numbers inside a module-level `StyleSheet.create`, which
 * runs once and cannot react to a hook. A device's physical size does not
 * change while the app runs, and the scale uses the orientation-independent
 * shortest/longest sides, so rotation does not change it either.
 */
export const uiTypeScale: number = (() => {
  const { width, height } = Dimensions.get("window");
  // A zero here means the window was measured before layout; fall back to the
  // phone scale rather than computing a nonsense one from 0x0.
  if (!width || !height) return 1;
  return typeScaleFor(classifyViewport(width, height));
})();

/**
 * Scale a one-off size that is not in the type scale.
 *
 * Over half the app's text sizes are literals rather than tokens — the library
 * grid's 13pt book titles, for instance. Wrapping the literal keeps the phone
 * design exactly as drawn (`ui(13)` is 13 on a phone) while letting it grow on
 * a tablet. Use it for `lineHeight` as well: scaling a font size and leaving
 * its line height behind is how text gets clipped.
 */
export function ui(size: number): number {
  return scaleFont(size, uiTypeScale);
}

export const fontSize = {
  xs: scaleFont(baseFontSize.xs, uiTypeScale),
  sm: scaleFont(baseFontSize.sm, uiTypeScale),
  base: scaleFont(baseFontSize.base, uiTypeScale),
  md: scaleFont(baseFontSize.md, uiTypeScale),
  lg: scaleFont(baseFontSize.lg, uiTypeScale),
  xl: scaleFont(baseFontSize.xl, uiTypeScale),
  "2xl": scaleFont(baseFontSize["2xl"], uiTypeScale),
  "3xl": scaleFont(baseFontSize["3xl"], uiTypeScale),
} as const;

export const fontWeight = {
  normal: "400" as const,
  medium: "500" as const,
  semibold: "600" as const,
  bold: "700" as const,
};
