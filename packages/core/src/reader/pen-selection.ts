/**
 * Owning text selection in paginated mode, instead of asking the WebView for it.
 *
 * WHY THIS EXISTS. In paginated mode the book is laid out as one long strip of
 * CSS columns and the container is scrolled along it — measured on a Boox Note
 * Air 4C: a document 15583 wide for a page of 599. Android's WebView resolves
 * a touch for text selection against that untransformed strip, so a pen landing
 * on the visible page can resolve to a column two pages away. The reader's own
 * trace of the failure:
 *
 *   check         isPointerSelecting=true   textLength=3
 *   edge-release  x=3168  reason="pointercancel"
 *   check         isPointerSelecting=false  textLength=835
 *
 * Three characters, then the pointer cancelled, then 835 characters in a single
 * step with nothing touching the screen. Declining that after the fact does not
 * work: the WebView rebuilds the selection faster than it can be refused, which
 * is a tug of war, and it was lost.
 *
 * THE FIX. Both ends of a selection built here come from a coordinate the
 * reader's pen actually touched, and a touched coordinate is on the visible
 * page by definition. There is no step at which an untouched coordinate can
 * enter, so a selection cannot reach another page — not because it is checked
 * and rejected, but because it is never constructible.
 *
 * This module is the gesture only: when a press becomes a selection, and what
 * the two endpoints are. Turning points into a range is the caller's job, since
 * that needs a document.
 */

/** How long a pointer must rest before a press becomes a selection. */
export const SELECTION_HOLD_MS = 350;

/** How far a pointer may drift during that hold and still count as resting. */
export const SELECTION_HOLD_SLOP_PX = 10;

export interface Point {
  x: number;
  y: number;
}

export type GesturePhase =
  /** Nothing is happening. */
  | "idle"
  /** A pointer is down; it is not yet known whether this is a tap, a swipe or a selection. */
  | "pressing"
  /** The hold completed: this gesture is a selection and owns the pointer. */
  | "selecting";

export interface GestureState {
  phase: GesturePhase;
  /** Where the pointer went down. The selection's anchor. */
  origin: Point | null;
  /** Where it is now. The selection's focus. */
  focus: Point | null;
  /** When the press started, for the caller's hold timer. */
  startedAt: number;
  /** Set once the pointer has moved beyond the slop before the hold completed. */
  movedEarly: boolean;
}

export function idleGesture(): GestureState {
  return { phase: "idle", origin: null, focus: null, startedAt: 0, movedEarly: false };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A pointer went down. */
export function onPointerDown(point: Point, now: number): GestureState {
  return { phase: "pressing", origin: point, focus: point, startedAt: now, movedEarly: false };
}

/**
 * The pointer moved.
 *
 * Before the hold completes, movement means this is a swipe or a scroll, not a
 * selection — the gesture is marked so the hold cannot later claim it. That is
 * what keeps page-turn swipes working: a swipe moves immediately, a selection
 * rests first.
 */
export function onPointerMove(state: GestureState, point: Point): GestureState {
  if (state.phase === "idle" || !state.origin) return state;

  if (state.phase === "pressing") {
    const movedEarly = state.movedEarly || distance(state.origin, point) > SELECTION_HOLD_SLOP_PX;
    return { ...state, focus: point, movedEarly };
  }

  return { ...state, focus: point };
}

/**
 * The hold timer fired. Does this press become a selection?
 *
 * Only if the pointer is still down and has stayed put. A press that already
 * wandered belongs to whatever gesture it wandered into.
 */
export function onHoldElapsed(state: GestureState): GestureState {
  if (state.phase !== "pressing" || state.movedEarly) return state;
  return { ...state, phase: "selecting" };
}

/** The pointer left. Whatever the gesture was, it is over. */
export function onPointerUp(): GestureState {
  return idleGesture();
}

/** Whether this gesture currently owns the pointer, and others should stand off. */
export function isSelecting(state: GestureState): boolean {
  return state.phase === "selecting";
}

/**
 * The two points a range should be built between, or null if there is nothing
 * to build yet. Ordered as anchor then focus; the caller decides which way
 * round the document they fall.
 */
export function selectionEndpoints(state: GestureState): [Point, Point] | null {
  if (state.phase !== "selecting" || !state.origin || !state.focus) return null;
  return [state.origin, state.focus];
}

/**
 * Whether a tap should be treated as a page turn.
 *
 * A press that never became a selection and never wandered is a tap, however
 * long it was held — holding still on an e-ink screen is easy to do by accident
 * and should not silently arm anything the reader did not ask for.
 */
export function wasTap(state: GestureState, now: number): boolean {
  return (
    state.phase === "pressing" && !state.movedEarly && now - state.startedAt < SELECTION_HOLD_MS
  );
}

/** Install on the reader webview's global, the way the other engines are. */
export function installReadAnyPenSelection(root: unknown): void {
  const target = (root ?? {}) as Record<string, unknown>;
  target.ReadAnyPenSelection = {
    SELECTION_HOLD_MS,
    SELECTION_HOLD_SLOP_PX,
    idleGesture,
    onPointerDown,
    onPointerMove,
    onHoldElapsed,
    onPointerUp,
    isSelecting,
    selectionEndpoints,
    wasTap,
  };
}
