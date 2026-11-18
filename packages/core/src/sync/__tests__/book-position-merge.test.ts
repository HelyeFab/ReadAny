import { describe, expect, it } from "vitest";
import { mergeBookPosition, remotePositionTimestamp } from "../simple-sync";

const local = (updatedAt: number, cfi = "local-cfi", progress = 0.4) => ({
  updatedAt,
  progress,
  currentCfi: cfi,
});

const remote = (fields: Record<string, unknown>) => ({
  id: "kitchen",
  title: "Kitchen",
  progress: 0.38,
  current_cfi: "remote-cfi",
  ...fields,
});

describe("remotePositionTimestamp", () => {
  it("uses position_updated_at when present", () => {
    expect(remotePositionTimestamp({ position_updated_at: 50, updated_at: 90 })).toBe(50);
  });

  it("falls back to updated_at for builds without the column", () => {
    expect(remotePositionTimestamp({ updated_at: 90 })).toBe(90);
    expect(remotePositionTimestamp({ position_updated_at: null, updated_at: 90 })).toBe(90);
  });
});

describe("mergeBookPosition", () => {
  it("THE BUG: the other device merely opened the book — its newer row must not carry its stale position over ours", () => {
    // Honor read to 40% at t=100. Boox opened the book at t=200 (row bumped) but its
    // position is from t=50.
    const r = remote({ updated_at: 200, position_updated_at: 50 });
    const out = mergeBookPosition(r, true, local(100));
    expect(out.record).toMatchObject({
      title: "Kitchen",
      current_cfi: "local-cfi",
      progress: 0.4,
      position_updated_at: 100,
    });
    expect(out.positionOnly).toBeNull();
  });

  it("we merely opened the book — the other device's newer position still comes in", () => {
    // Our row is newer (opened at t=300) but the other device READ at t=250, after our
    // last move at t=100.
    const r = remote({ updated_at: 250, position_updated_at: 250 });
    const out = mergeBookPosition(r, false, local(100));
    expect(out.record).toBeNull();
    expect(out.positionOnly).toEqual({ updatedAt: 250, progress: 0.38, currentCfi: "remote-cfi" });
  });

  it("a newer remote row with a newer position is applied whole", () => {
    const r = remote({ updated_at: 300, position_updated_at: 300 });
    const out = mergeBookPosition(r, true, local(100));
    expect(out.record).toBe(r);
    expect(out.positionOnly).toBeNull();
  });

  it("an older remote row with an older position changes nothing", () => {
    const r = remote({ updated_at: 50, position_updated_at: 50 });
    expect(mergeBookPosition(r, false, local(100))).toEqual({ record: null, positionOnly: null });
  });

  it("a new book (no local row) is applied as-is", () => {
    const r = remote({ updated_at: 50 });
    expect(mergeBookPosition(r, true, undefined)).toEqual({ record: r, positionOnly: null });
  });

  it("a remote record without position columns never overwrites the position on its own", () => {
    const r = { id: "kitchen", title: "Kitchen", updated_at: 50, position_updated_at: 999 };
    expect(mergeBookPosition(r, false, local(100))).toEqual({ record: null, positionOnly: null });
  });
});
