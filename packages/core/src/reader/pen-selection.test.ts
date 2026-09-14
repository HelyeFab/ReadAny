import { describe, expect, it } from "vitest";

import {
  SELECTION_HOLD_MS,
  SELECTION_HOLD_SLOP_PX,
  idleGesture,
  isSelecting,
  onHoldElapsed,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  selectionEndpoints,
  wasTap,
} from "./pen-selection";

const at = (x: number, y: number) => ({ x, y });

/** Press, optionally drift, wait out the hold. The way a selection begins. */
function heldPress(drift = 0) {
  let s = onPointerDown(at(100, 100), 0);
  if (drift) s = onPointerMove(s, at(100 + drift, 100));
  return onHoldElapsed(s);
}

describe("a press that rests becomes a selection", () => {
  it("does not select before the hold elapses", () => {
    const s = onPointerDown(at(100, 100), 0);
    expect(s.phase).toBe("pressing");
    expect(isSelecting(s)).toBe(false);
    expect(selectionEndpoints(s)).toBeNull();
  });

  it("selects once the hold elapses on a resting pointer", () => {
    expect(isSelecting(heldPress())).toBe(true);
  });

  it("tolerates a little drift — a pen on e-ink is never perfectly still", () => {
    expect(isSelecting(heldPress(SELECTION_HOLD_SLOP_PX - 1))).toBe(true);
  });
});

describe("a press that wanders does not", () => {
  it("refuses to select when the pointer moved past the slop first", () => {
    expect(isSelecting(heldPress(SELECTION_HOLD_SLOP_PX + 1))).toBe(false);
  });

  it("stays refused even if the pointer comes back to where it started", () => {
    let s = onPointerDown(at(100, 100), 0);
    s = onPointerMove(s, at(400, 100));
    s = onPointerMove(s, at(100, 100));
    expect(isSelecting(onHoldElapsed(s))).toBe(false);
  });

  it("leaves a page-turn swipe alone — this is what keeps swiping working", () => {
    let s = onPointerDown(at(500, 300), 0);
    for (const x of [480, 400, 300, 200]) s = onPointerMove(s, at(x, 300));
    expect(isSelecting(onHoldElapsed(s))).toBe(false);
  });
});

describe("the endpoints", () => {
  it("are the origin and the current point, in that order", () => {
    let s = heldPress();
    s = onPointerMove(s, at(260, 180));
    expect(selectionEndpoints(s)).toEqual([at(100, 100), at(260, 180)]);
  });

  it("follow the pointer as it moves", () => {
    let s = heldPress();
    s = onPointerMove(s, at(150, 100));
    expect(selectionEndpoints(s)?.[1]).toEqual(at(150, 100));
    s = onPointerMove(s, at(700, 260));
    expect(selectionEndpoints(s)?.[1]).toEqual(at(700, 260));
  });

  it("work backwards as readily as forwards", () => {
    let s = heldPress();
    s = onPointerMove(s, at(20, 40));
    expect(selectionEndpoints(s)).toEqual([at(100, 100), at(20, 40)]);
  });

  it("⭐ are both points the pointer actually touched — the whole reason this exists", () => {
    let s = heldPress();
    s = onPointerMove(s, at(260, 180));
    const [anchor, focus] = selectionEndpoints(s) ?? [];
    // Neither endpoint can be a coordinate no one touched, which is how the
    // WebView's own selection reached a column two pages away.
    expect([anchor, focus]).toEqual([at(100, 100), at(260, 180)]);
  });
});

describe("taps", () => {
  it("a quick press that did not move is a tap", () => {
    const s = onPointerDown(at(100, 100), 1000);
    expect(wasTap(s, 1000 + SELECTION_HOLD_MS - 1)).toBe(true);
  });

  it("a press held past the hold is not a tap", () => {
    const s = onPointerDown(at(100, 100), 1000);
    expect(wasTap(s, 1000 + SELECTION_HOLD_MS + 1)).toBe(false);
  });

  it("a press that moved is not a tap", () => {
    let s = onPointerDown(at(100, 100), 1000);
    s = onPointerMove(s, at(200, 100));
    expect(wasTap(s, 1010)).toBe(false);
  });

  it("a selection is never a tap", () => {
    expect(wasTap(heldPress(), 99999)).toBe(false);
  });
});

describe("lifecycle", () => {
  it("lifting ends the gesture whatever it was", () => {
    expect(onPointerUp().phase).toBe("idle");
    expect(isSelecting(onPointerUp())).toBe(false);
  });

  it("ignores movement when nothing is pressed", () => {
    const s = idleGesture();
    expect(onPointerMove(s, at(10, 10))).toEqual(s);
  });

  it("ignores a hold when nothing is pressed", () => {
    expect(onHoldElapsed(idleGesture()).phase).toBe("idle");
  });

  it("starts idle", () => {
    const s = idleGesture();
    expect(s.phase).toBe("idle");
    expect(selectionEndpoints(s)).toBeNull();
  });
});
