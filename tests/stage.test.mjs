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

const spec = { steps: [{ screen: "a", seconds: 10 }, { screen: "b", seconds: 5 }], face: 0 };

// Screens follow screens: a (10) -> b (5) -> a, Alfie never in between.
{
  const rot = G.start(spec, 0);
  eq(G.advance(rot, 0), { id: "a", next: "b", appear: false }, "starts on the first screen");
  eq(G.advance(rot, 9.9).id, "a", "still a");
  eq(G.advance(rot, 10), { id: "b", next: "a", appear: false }, "straight to b");
  eq(G.advance(rot, 15).id, "a", "round to a");
}

// face > 0: Alfie between every pair of screens, appearing once each time.
{
  const rot = G.start({ ...spec, face: 20 }, 0);
  eq(G.advance(rot, 10), { id: null, next: "b", appear: true }, "Alfie after a");
  eq(G.advance(rot, 11).appear, false, "appears once");
  eq(G.advance(rot, 30).id, "b", "b after him");
  eq(G.advance(rot, 35).id, null, "Alfie after b");
  eq(G.advance(rot, 55).id, "a", "round to a");
}

// An Alfie step: he appears, and stays for his story when it runs longer.
{
  const rot = G.start({ steps: [{ screen: "a", seconds: 10 }, { alfie: true, seconds: 5 }, { screen: "b", seconds: 10 }], face: 20 }, 0);
  eq(G.advance(rot, 10), { id: null, next: "b", appear: true }, "Alfie step, no gap before it");
  rot.hold = 12;                                   // the card: his story runs 12 s
  eq(G.advance(rot, 21).id, null, "held for the story");
  eq(G.advance(rot, 22).id, "b", "then b, no gap after an Alfie step");
  eq(G.advance(rot, 32).id, null, "a gap after b (face 20)");
  eq(G.advance(rot, 52).id, "a", "and round");
}

// A rotation that starts on Alfie appears at once; only Alfie steps still terminate.
{
  const rot = G.start({ steps: [{ alfie: true, seconds: 5 }, { screen: "a", seconds: 5 }], face: 0 }, 0);
  eq(G.advance(rot, 0), { id: null, next: "a", appear: true }, "starts on Alfie");
  const solo = G.start({ steps: [{ alfie: true, seconds: 5 }], face: 0 }, 0);
  eq(G.advance(solo, 1e4).id, null, "only Alfie terminates");
}

// runStory: expressions and places hold, screens only for their own time, animations fire once.
{
  const acts = [
    { kind: "expression", value: { name: "sad", blend: 0 }, seconds: 1 },
    { kind: "animation", value: "nod", seconds: 1 },
    { kind: "screen", value: { id: "plants", seconds: 4 }, seconds: 4 },
    { kind: "place", value: { x: 1, y: 1, scale: 0.5, seconds: 1 }, seconds: 1 },
    { kind: "animation", value: "shake", seconds: 0 },
  ];
  eq(G.storyLength(acts), 7, "length");
  const s0 = G.runStory(acts, -1, 0);
  eq([s0.expression, s0.fire, s0.screen, s0.done], ["sad", [], null, false], "starts with the expression");
  eq(G.runStory(acts, 0, 1).fire, ["nod"], "nod at 1 s");
  eq(G.runStory(acts, 1, 1.5).fire, [], "nod only once");
  eq(G.runStory(acts, 1.5, 3).screen?.id, "plants", "screen from 2 s");
  const s6 = G.runStory(acts, 5.9, 6.5);
  eq([s6.screen, s6.place?.x], [null, 1], "screen gone when the place starts");
  const s7 = G.runStory(acts, 6.5, 7);
  eq([s7.fire, s7.done, s7.expression], [["shake"], true, "sad"], "shake at the end, done");
}

// A jump far ahead (the tab was hidden) still lands somewhere sane.
{
  const rot = G.start(spec, 0);
  const w = G.advance(rot, 1e4);
  eq(typeof w.id === "string" || w.id === null, true, "a long jump terminates");
}

// Carrying a running rotation into new steps keeps its place.
{
  const rot = G.start(spec, 0);
  G.advance(rot, 11);                           // on b
  const more = G.carry(rot, { ...spec, steps: [...spec.steps, { screen: "c", seconds: 15 }] });
  eq([more.idx, more.phase, more.t0], [1, "screen", 10], "carry keeps idx, phase and clock");
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
