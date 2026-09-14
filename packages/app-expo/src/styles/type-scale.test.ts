import { describe, expect, it } from "vitest";
import { classifyViewport, scaleFont, typeScaleFor } from "./viewport";

/** Viewports in density-independent pixels, as React Native reports them. */
const DEVICES = {
  phone: { width: 412, height: 915 },
  foldableOpen: { width: 674, height: 841 },
  ipadMini: { width: 744, height: 1133 },
  // Boox Note Air 4C: 1860x2480 physical at density 300.
  booxNoteAir4C: { width: 1860 / 1.875, height: 2480 / 1.875 },
};

describe("type scale", () => {
  it("leaves phone text exactly as designed", () => {
    const phone = classifyViewport(DEVICES.phone.width, DEVICES.phone.height);
    expect(phone.isTablet).toBe(false);
    expect(typeScaleFor(phone)).toBe(1);
  });

  it("enlarges text on the 10-inch e-ink tablet that prompted this", () => {
    const { width, height } = DEVICES.booxNoteAir4C;
    const boox = classifyViewport(width, height);

    expect(boox.isTablet).toBe(true);
    expect(boox.isLargeTablet).toBe(true);
    expect(typeScaleFor(boox)).toBeGreaterThan(1.3);
  });

  it("scales by the same rule the layout uses, so padding and type agree", () => {
    // Anything the layout calls a tablet must get tablet type, or a screen ends
    // up with tablet gutters around phone-sized words.
    for (const { width, height } of Object.values(DEVICES)) {
      const viewport = classifyViewport(width, height);
      if (viewport.isTablet) expect(typeScaleFor(viewport)).toBeGreaterThan(1);
      else expect(typeScaleFor(viewport)).toBe(1);
    }
  });

  it("does not change with rotation", () => {
    const { width, height } = DEVICES.booxNoteAir4C;
    const portrait = typeScaleFor(classifyViewport(width, height));
    const landscape = typeScaleFor(classifyViewport(height, width));
    expect(landscape).toBe(portrait);
  });

  it("rounds to half points, so sizes stay tidy", () => {
    expect(scaleFont(14, 1.4)).toBe(19.5);
    expect(scaleFont(16, 1.4)).toBe(22.5);
    expect(scaleFont(12, 1)).toBe(12);
  });

  it("keeps the scale monotonic across screen sizes", () => {
    const phone = typeScaleFor(classifyViewport(412, 915));
    const tablet = typeScaleFor(classifyViewport(744, 1133));
    const large = typeScaleFor(classifyViewport(992, 1323));
    expect(tablet).toBeGreaterThanOrEqual(phone);
    expect(large).toBeGreaterThanOrEqual(tablet);
  });
});
