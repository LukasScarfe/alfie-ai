// Transitions between Alfie and a screen (docs/screens-contract.md "Intros").
// This is the foundation stub: `cut` and `fade`. The intros agent adds the
// rest (draw, zoom, slide, condense, morph...) behind the same three calls.
//
// A transition runs u = 0..1 over SECONDS[style]. `presence(style, u, leaving)`
// is how present the arriving thing is (0 gone, 1 fully there, may overshoot);
// leaving is the same intro with presence reversed. `apply` shapes strokes for
// a presence, and returns the alpha to draw them at.

export const STYLES = ["cut", "fade"];
export const SECONDS = { cut: 0, fade: 0.6 };

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (u) => u * u * (3 - 2 * u);

export function presence(style, u, leaving = false) {
  u = clamp01(u);
  const p = style === "cut" ? (u >= 1 ? 1 : 0) : smooth(u);
  return leaving ? 1 - p : p;
}

// `strokes` are contract strokes in the screen box ({w, h} half-extents); the
// returned ones may be new or the same. Alpha is what to draw them at (0..1).
export function apply(style, p, leaving, strokes, box) {
  if (style === "cut") return { strokes, alpha: p >= 0.5 ? 1 : 0 };
  return { strokes, alpha: clamp01(p) };
}
