/** Viewport-aware placement for the keyword rule tooltip.
 *
 *  The tooltip anchors below its keyword chip, but a fixed below-and-left position
 *  runs off-screen when the chip sits near the bottom (or right) edge and the rule
 *  text is long. Given the anchor's rect, the measured tooltip size, and the
 *  viewport, this returns a `left`/`top` (viewport/`position:fixed` coordinates)
 *  that keeps the tooltip on screen: below the chip when it fits, flipped above it
 *  when it would overflow the bottom, and clamped within the left/right margins.
 */
export function placeTooltip(
  anchor: { top: number; bottom: number; left: number },
  tip: { width: number; height: number },
  viewport: { width: number; height: number },
  opts: { gap?: number; margin?: number } = {},
): { left: number; top: number } {
  const gap = opts.gap ?? 6;
  const margin = opts.margin ?? 8;

  // Prefer below the chip; flip above when the bottom would overflow. If neither
  // side fits (a rule taller than the space above the chip), keep the top edge on
  // screen so the start of the text is always visible.
  let top = anchor.bottom + gap;
  if (top + tip.height > viewport.height - margin) {
    const above = anchor.top - gap - tip.height;
    top = above >= margin ? above : Math.max(margin, viewport.height - margin - tip.height);
  }

  // Clamp horizontally: never past the right margin, never before the left margin.
  const left = Math.max(margin, Math.min(anchor.left, viewport.width - tip.width - margin));

  return { left, top };
}
