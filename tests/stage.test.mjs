// The card's rotation clock and story placement (alfie-stage.js).
// Run by ./dev test under node; no packages needed.
import * as G from "../custom_components/alfie/frontend/alfie-stage.js";

let failures = 0, checks = 0;
function eq(a, b, what) {
  checks++;
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    failures++;
    console.error(`FAIL ${what}\n  got  ${JSON.stringify(a)}\n  want ${JSON.stringify(b)}`);
  }
}
function near(a, b, what, tol = 1e-6) {
  checks++;
  if (Math.abs(a - b) > tol) { failures++; console.error(`FAIL ${what}: got ${a}, want ${b}`); }
}

const spec = { steps: [{ screen: "a", seconds: 10 }, { screen: "b", seconds: 5 }], face: 20 };

// Plain cycle: a (10) -> face (20) -> b (5) -> face (20) -> a.
{
  const rot = G.start(spec, 0);
  const at = (t) => G.advance(rot, t, { badNews: false });
  eq(at(0).id, "a", "starts on the first screen");
  eq(at(9.9).id, "a", "still a");
  eq(at(10), { id: null, next: "b", shake: false }, "face after a, prefetching b");
  eq(at(30).id, "b", "b after the face");
  eq(at(35).id, null, "face after b");
  eq(at(55).id, "a", "round to a");
}

// Bad news: after the face, each wrong screen, then back with one shake.
{
  const rot = G.start(spec, 0);
  let wrong = ["plants", "nas"];
  const opt = { badSeconds: 10, badNow: () => wrong };
  eq(G.advance(rot, 10, opt).id, null, "face");
  eq(G.advance(rot, 30, opt), { id: "plants", next: "nas", shake: false }, "first wrong screen");
  eq(G.advance(rot, 40, opt).id, "nas", "second wrong screen");
  eq(G.advance(rot, 50, opt), { id: null, next: "b", shake: true }, "back, shaking");
  eq(G.advance(rot, 51, opt).shake, false, "one shake only");
  eq(G.advance(rot, 50 + G.BACK_SECONDS, opt).id, "b", "then the rotation resumes");
  wrong = [];
  eq(G.advance(rot, 58, opt).id, null, "face after b");
  eq(G.advance(rot, 78, opt).id, "a", "nothing wrong: straight on");
}

// A jump far ahead (the tab was hidden) still lands somewhere sane.
{
  const rot = G.start(spec, 0);
  const w = G.advance(rot, 1e4, { badNews: false });
  eq(typeof w.id === "string" || w.id === null, true, "a long jump terminates");
}

// Carrying a running rotation into new steps keeps its place.
{
  const rot = G.start(spec, 0);
  G.advance(rot, 31, { badNews: false });       // on b
  const more = G.carry(rot, { ...spec, steps: [...spec.steps, { screen: "c", seconds: 15 }] });
  eq([more.idx, more.phase, more.t0], [1, "screen", 30], "carry keeps idx, phase and clock");
  const fewer = G.carry(rot, { ...spec, steps: [spec.steps[0]] });
  eq(fewer.idx, 0, "carry wraps the index");
}

// Placement springs toward the target and home again.
{
  let p = { ...G.HOME };
  const target = { x: 1, y: -1, scale: 0.5, seconds: 0.6 };
  for (let i = 0; i < 60; i++) p = G.placeToward(p, target, 1 / 30);
  near(p.x, 1, "x arrives", 1e-3); near(p.y, -1, "y arrives", 1e-3); near(p.s, 0.5, "scale arrives", 1e-3);
  eq(G.atHome(p), false, "away from home");
  for (let i = 0; i < 90; i++) p = G.placeToward(p, null, 1 / 30);
  eq(G.atHome(p), true, "null target springs home");
  const half = G.placeToward({ ...G.HOME }, target, 0.2);
  eq(half.x > 0 && half.x < 1, true, "moves part way in one step");
}

// placeAt keeps the ring on the canvas.
{
  const c = G.placeAt({ x: 1, y: 1, s: 0.5 }, 400, 200, 90);
  near(c.cx, 400 - 90 * 0.5 * 1.02, "right edge");
  near(c.cy, 90 * 0.5 * 1.02, "top edge");
  const big = G.placeAt({ x: 1, y: 0, s: 1.5 }, 200, 200, 90);
  near(big.cx, 100, "too big to move stays centred");
}

console.log(`stage: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
