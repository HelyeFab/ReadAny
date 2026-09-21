import * as SecureStore from "expo-secure-store";
/**
 * ThemeContext — provides light / dark / sepia theme support matching Tauri mobile.
 *
 * oklch values from globals.css are converted to hex.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

export type ThemeMode =
  | "light"
  | "dark"
  | "sepia"
  | "oled"
  | "apricot"
  | "coral"
  | "rose"
  | "sage"
  | "jade"
  | "teal"
  | "indigo";

export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  primaryForeground: string;
  destructive: string;
  destructiveForeground: string;
  accent: string;
  accentForeground: string;
  // Functional
  indigo: string;
  emerald: string;
  amber: string;
  blue: string;
  violet: string;
  // Highlight colors
  highlightYellow: string;
  highlightGreen: string;
  highlightBlue: string;
  highlightPink: string;
  highlightPurple: string;
  // Fallback cover gradients
  stone100: string;
  stone200: string;
  stone300: string;
  stone400: string;
  stone500: string;
}

// ── Light theme (from :root in globals.css) ──
const lightColors: ThemeColors = {
  background: "#faf9f5",
  foreground: "#1c1c1e",
  card: "#ffffff",
  cardForeground: "#1c1c1e",
  muted: "#f2f1ed",
  mutedForeground: "#7c7c82",
  border: "#e5e5e5",
  primary: "#2d2d30",
  primaryForeground: "#fafafa",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#f5f5f5",
  accentForeground: "#2d2d30",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Dark theme (from .dark in globals.css) ──
const darkColors: ThemeColors = {
  background: "#1c1c1e",
  foreground: "#e8e8ed",
  card: "#2c2c2e",
  cardForeground: "#e8e8ed",
  muted: "#333336",
  mutedForeground: "#7c7c82",
  border: "#3d3d40",
  primary: "#e0e0e6",
  primaryForeground: "#1c1c1e",
  destructive: "#e53935",
  destructiveForeground: "#ffffff",
  accent: "#363638",
  accentForeground: "#e0e0e6",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#a78bfa",
  highlightYellow: "#854d0e",
  highlightGreen: "#166534",
  highlightBlue: "#1e40af",
  highlightPink: "#9d174d",
  highlightPurple: "#6b21a8",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// OLED theme — true-black canvas with the existing dark elevated surfaces.
const oledColors: ThemeColors = {
  ...darkColors,
  background: "#000000",
};

// ── Sepia theme (from [data-theme="sepia"] in globals.css) ──
const sepiaColors: ThemeColors = {
  background: "#f0e6d2",
  foreground: "#3d2b1f",
  card: "#f5ebd7",
  cardForeground: "#3d2b1f",
  muted: "#e6d9c3",
  mutedForeground: "#7a6652",
  border: "#d4c4a8",
  primary: "#6b4c2a",
  primaryForeground: "#f5ebd7",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#e6d9c3",
  accentForeground: "#4a3728",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Tinted paper themes ──
// One per band of the reference palette. Each is derived from its seed hue:
// paper tinted toward the hue, ink near-black but carrying the same hue, and
// the seed itself darkened for controls so it stays legible on a light page.

// ── Apricot (#ffc196) ──
const apricotColors: ThemeColors = {
  background: "#f8e6d8",
  foreground: "#2d2520",
  card: "#fff7f0",
  cardForeground: "#2d2520",
  muted: "#f0d8c6",
  mutedForeground: "#7f6b5c",
  border: "#dfbfa8",
  primary: "#b54a00",
  primaryForeground: "#fcfbfb",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#f5d5be",
  accentForeground: "#993f00",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Coral (#ff7a83) ──
const coralColors: ThemeColors = {
  background: "#f8e1e3",
  foreground: "#2d2020",
  card: "#fff5f5",
  cardForeground: "#2d2020",
  muted: "#f1cfd2",
  mutedForeground: "#7f5c5f",
  border: "#e3b4b9",
  primary: "#b5000c",
  primaryForeground: "#fcfbfb",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#f5cdd0",
  accentForeground: "#99000a",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Rose (#c5638a) ──
const roseColors: ThemeColors = {
  background: "#f3e1e8",
  foreground: "#2c2025",
  card: "#fff5f8",
  cardForeground: "#2c2025",
  muted: "#eacdd8",
  mutedForeground: "#7f5c6a",
  border: "#dcb5c4",
  primary: "#843152",
  primaryForeground: "#fcfbfb",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#eccbd8",
  accentForeground: "#702945",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Sage (#a5b587) ──
const sageColors: ThemeColors = {
  background: "#e8eedf",
  foreground: "#272923",
  card: "#f8fbed",
  cardForeground: "#272923",
  muted: "#d8e0ca",
  mutedForeground: "#707765",
  border: "#bdcba8",
  primary: "#647a3b",
  primaryForeground: "#fbfbfb",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#d7e2c7",
  accentForeground: "#556732",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Jade (#58af8c) ──
const jadeColors: ThemeColors = {
  background: "#dff0e9",
  foreground: "#222b27",
  card: "#f2fbf7",
  cardForeground: "#222b27",
  muted: "#cce3da",
  mutedForeground: "#607b70",
  border: "#add2c3",
  primary: "#3b7a61",
  primaryForeground: "#fbfcfb",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#c9e5da",
  accentForeground: "#326752",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Teal (#009d95) ──
const tealColors: ThemeColors = {
  background: "#dcf0ef",
  foreground: "#202d2c",
  card: "#f0fbfa",
  cardForeground: "#202d2c",
  muted: "#c5e2e0",
  mutedForeground: "#5c7f7d",
  border: "#a5d2cf",
  primary: "#00b5ac",
  primaryForeground: "#fbfcfc",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#c1e6e3",
  accentForeground: "#009991",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

// ── Deep Blue (#006294) ──
const indigoColors: ThemeColors = {
  background: "#e0ebf3",
  foreground: "#20282d",
  card: "#f2f8fc",
  cardForeground: "#20282d",
  muted: "#cbdce8",
  mutedForeground: "#5c737f",
  border: "#adc8da",
  primary: "#0078b5",
  primaryForeground: "#fbfbfc",
  destructive: "#e53935",
  destructiveForeground: "#fafafa",
  accent: "#c8dfed",
  accentForeground: "#006599",
  indigo: "#6366f1",
  emerald: "#10b981",
  amber: "#f59e0b",
  blue: "#3b82f6",
  violet: "#7c3aed",
  highlightYellow: "#fef08a",
  highlightGreen: "#bbf7d0",
  highlightBlue: "#bfdbfe",
  highlightPink: "#fbcfe8",
  highlightPurple: "#e9d5ff",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
};

const THEME_MAP: Record<ThemeMode, ThemeColors> = {
  light: lightColors,
  dark: darkColors,
  sepia: sepiaColors,
  oled: oledColors,
  apricot: apricotColors,
  coral: coralColors,
  rose: roseColors,
  sage: sageColors,
  jade: jadeColors,
  teal: tealColors,
  indigo: indigoColors,
};

const STORAGE_KEY = "readany-theme";

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  setMode: (mode: ThemeMode) => void;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: "sepia",
  colors: sepiaColors,
  setMode: () => {},
  isDark: false,
});

export function ThemeProvider({
  children,
  initialMode = "sepia",
}: {
  children: ReactNode;
  initialMode?: ThemeMode;
}) {
  const [mode, setModeState] = useState<ThemeMode>(initialMode);

  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY).then((saved) => {
      // Checked against the theme map rather than a written-out list: a
      // hardcoded list silently discards any theme added later, so the choice
      // is saved and then refused on the next launch.
      if (saved && Object.hasOwn(THEME_MAP, saved)) {
        setModeState(saved as ThemeMode);
      }
    });
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    SecureStore.setItemAsync(STORAGE_KEY, m);
  }, []);

  const value: ThemeContextValue = {
    mode,
    colors: THEME_MAP[mode],
    setMode,
    isDark: mode === "dark" || mode === "oled",
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

/**
 * Helper: get the initial theme synchronously for static styles.
 * Components that need reactive theme should use useTheme() instead.
 */
export { lightColors, darkColors, sepiaColors, oledColors, THEME_MAP };
