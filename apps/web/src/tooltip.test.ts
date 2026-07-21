import { describe, it, expect } from "vitest";
import { placeTooltip } from "./tooltip";

const vp = { width: 1000, height: 800 };

describe("placeTooltip", () => {
  it("places below the anchor when there is room", () => {
    const pos = placeTooltip({ top: 100, bottom: 120, left: 200 }, { width: 280, height: 90 }, vp);
    expect(pos).toEqual({ left: 200, top: 126 }); // bottom + gap
  });

  it("flips above the anchor when the tooltip would overflow the bottom", () => {
    // Chip near the bottom; a tall tooltip below would run off-screen.
    const pos = placeTooltip({ top: 740, bottom: 760, left: 200 }, { width: 280, height: 120 }, vp);
    expect(pos.top).toBe(740 - 6 - 120); // anchor.top - gap - height = 614
    expect(pos.left).toBe(200);
  });

  it("bottom-aligns within the margins when below doesn't fit but the tooltip still fits", () => {
    // Chip low, tall-but-fits tooltip: neither the below nor the above slot fits, so it
    // bottom-aligns (fully visible) rather than overflowing.
    const pos = placeTooltip({ top: 700, bottom: 720, left: 100 }, { width: 280, height: 780 }, vp);
    expect(pos.top).toBe(800 - 8 - 780); // viewport - margin - height = 12, bottom edge on the margin
  });

  it("clamps the top to the margin when the rule is taller than the viewport", () => {
    // Pathological: taller than the screen — keep the top (start of text) visible.
    const pos = placeTooltip({ top: 700, bottom: 720, left: 100 }, { width: 280, height: 900 }, vp);
    expect(pos.top).toBe(8); // margin
  });

  it("clamps left so the tooltip never overflows the right edge", () => {
    const pos = placeTooltip({ top: 100, bottom: 120, left: 950 }, { width: 280, height: 90 }, vp);
    expect(pos.left).toBe(1000 - 280 - 8); // viewport.width - width - margin = 712
  });

  it("clamps left to the margin when the anchor is off the left edge", () => {
    const pos = placeTooltip({ top: 100, bottom: 120, left: -20 }, { width: 280, height: 90 }, vp);
    expect(pos.left).toBe(8); // margin
  });

  it("honours custom gap and margin", () => {
    const pos = placeTooltip({ top: 100, bottom: 120, left: 200 }, { width: 100, height: 50 }, vp, { gap: 10, margin: 20 });
    expect(pos).toEqual({ left: 200, top: 130 });
  });
});
