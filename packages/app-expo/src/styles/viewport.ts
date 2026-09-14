/**
 * One definition of "how big is this screen", shared by layout and type.
 *
 * The app already decided what a tablet is, in `use-responsive-layout`. Type
 * size has to agree with that decision — a screen wide enough to get tablet
 * padding is a screen that should get tablet-sized text — so the rules live
 * here and both callers read them, rather than each carrying its own guess.
 */

export interface Viewport {
  shortestSide: number;
  longestSide: number;
  isLandscape: boolean;
  isTablet: boolean;
  isTabletLandscape: boolean;
  isLargeTablet: boolean;
}

export function classifyViewport(width: number, height: number): Viewport {
  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);

  const isLandscape = width > height;
  const isTablet = shortestSide >= 768 || (shortestSide >= 600 && longestSide >= 960);
  const isTabletLandscape = isTablet && isLandscape;
  const isLargeTablet = isTablet && longestSide >= 1280;

  return { shortestSide, longestSide, isLandscape, isTablet, isTabletLandscape, isLargeTablet };
}

/**
 * How much bigger text should be on this screen.
 *
 * A density-independent pixel is the same physical size everywhere — 1/160
 * inch — so the flat scale the app shipped with made text on a 10" e-ink
 * tablet the same physical height as text on a phone. That is the bug: a
 * tablet is held further away and its lines are far wider, so identical
 * physical size reads as much smaller. These multipliers restore the
 * proportion rather than adding "big text" as a preference.
 *
 * Deliberately driven by the screen's own size, not by the system font scale.
 * A device set to 0.85 (as the Boox Note Air is out of the box) still gets its
 * setting honoured by React Native on top of this — the user asked for smaller
 * text and continues to get smaller text, just smaller text that started from
 * a size appropriate to the screen.
 */
export function typeScaleFor(viewport: Viewport): number {
  if (viewport.isLargeTablet) return 1.4;
  if (viewport.isTablet) return 1.2;
  return 1;
}

/** Round to a half point — below that, layout jitters without looking different. */
export function scaleFont(size: number, scale: number): number {
  return Math.round(size * scale * 2) / 2;
}
