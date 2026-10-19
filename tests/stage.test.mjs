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
function ok(v, what) { eq(!!v, true, what); }
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

// An Alfie step: he appears for exactly its seconds, as a screen's turn, whatever his story's length.
{
  const rot = G.start({ steps: [{ screen: "a", seconds: 10 }, { alfie: true, seconds: 5 }, { screen: "b", seconds: 10 }], face: 20 }, 0);
  eq(G.advance(rot, 10), { id: null, next: "b", appear: true }, "Alfie step, no gap before it");
  eq(G.advance(rot, 14.9).id, null, "his turn");
  eq(G.advance(rot, 15).id, "b", "then b on the beat, no gap after an Alfie step");
  eq(G.advance(rot, 25).id, null, "a gap after b (face 20)");
  eq(G.advance(rot, 45).id, "a", "and round");
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

// screenEnd: a story screen that ends within a frame, so the card can stop there.
{
  const acts = [
    { kind: "expression", value: { name: "sad", blend: 0 }, seconds: 1 },
    { kind: "screen", value: { id: "plants", seconds: 2 }, seconds: 2 },
    { kind: "animation", value: "shake", seconds: 1 },
  ];
  eq(G.screenEnd(acts, 2.9, 3.05), 3, "the screen ends in this frame");
  eq(G.screenEnd(acts, 2.0, 2.5), null, "still on show");
  eq(G.screenEnd(acts, 0.5, 3.5), null, "no screen on show yet");
  eq(G.runStory(acts, 3 - 1e-6, 3.2).fire, ["shake"], "what follows fires once resumed");
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

// Icons: the same actions as stories.icon_action, fired once by runStory.
{
  const t = G.iconAction({ icon: "mdi:heart", style: "transform", transform: "ring", seconds: 4 });
  eq([t.kind, t.value.present, t.value.transition, t.value.icon.ring, t.seconds], ["screen", "handover", "morph", true, 4], "transform is a morph screen");
  const b = G.iconAction({ style: "beside", corner: "top_left" });
  eq([b.value.present, b.value.icon.corner, b.value.id], ["corner", "top_left", "@icon"], "beside is a corner screen");
  const o = G.iconAction({ style: "overlay", place: "above" }, false);
  eq([o.kind, o.value.place, o.seconds], ["icon", "above", 0], "overlay is a badge");
  const acts = [{ kind: "icon", value: { name: "a" }, seconds: 2 }, { kind: "wait", value: null, seconds: 1 }];
  eq(G.runStory(acts, -1, 0).icons.length, 1, "a badge fires at its start");
  eq(G.runStory(acts, 0, 1).icons.length, 0, "and only once");
}

// Badges: placed beside the face, in corners, kept on the card.
{
  const face = { cx: 100, cy: 100, r: 80 };
  const above = G.badgeAt({ place: "above", size: 1 }, 400, 200, 80, face, 8);
  near(above.s, 28, "badge half size");
  near(above.cx, 100, "above: over his centre");
  near(above.cy, 36, "above: kept on the card");
  const right = G.badgeAt({ place: "right", size: 1 }, 400, 200, 80, face, 8);
  near(right.cx, 100 + 80 + 7 + 28, "right: just off his ring");
  const tr = G.badgeAt({ place: "top_right", size: 1 }, 400, 200, 80, face, 8);
  eq([tr.cx, tr.cy], [400 - 36, 36], "top right corner");
  const c = G.badgeAt({ place: "custom", x: -1, y: 1, size: 1 }, 400, 200, 80, face, 8);
  eq([c.cx, c.cy], [36, 36], "custom x -1, y 1 is top left");
}

// A screen's say in its turn: skip passes it over free, seconds lengthen it.
{
  const three = { steps: [{ screen: "a", seconds: 10 }, { screen: "b", seconds: 5 }, { screen: "c", seconds: 5 }], face: 20 };
  let say = { b: { skip: true } };
  const fit = (id) => say[id] ?? null;
  const rot = G.start(three, 0);
  eq(G.advance(rot, 0, fit).id, "a", "a first");
  eq(G.advance(rot, 10, fit).id, null, "Alfie's gap after a");
  eq(G.advance(rot, 30, fit).id, "c", "b skipped, straight to c with no second gap");
  eq(G.advance(rot, 34.9, fit).id, "c", "c keeps its own 5 s");
  say = { a: { seconds: 18 } };
  eq(G.advance(rot, 55, fit).id, "a", "round to a after c's gap");
  say = { a: { seconds: 2 } };
  eq(G.advance(rot, 72, fit).id, "a", "a's 18 s were fixed when its turn began");
  eq(G.advance(rot, 73, fit).id, null, "then the gap");
}
{
  let say = { a: { skip: true }, b: { skip: true } };
  const fit = (id) => say[id] ?? null;
  const rot = G.start(spec, 0);
  eq(G.advance(rot, 0, fit), { id: null, next: null, appear: false }, "every screen skips: Alfie has the stage");
  say = {};
  eq(G.advance(rot, 0.5, fit).id, null, "looks again only after SKIP_RECHECK");
  eq(G.advance(rot, 1.2, fit).id, "a", "something to show: back on");
  eq(G.advance(rot, 11, fit).id, "a", "its turn counts from when it came back");
  eq(G.advance(rot, 11.3, fit).id, "b", "then b");
}
{
  const rot = G.start({ steps: [{ screen: "a", seconds: 10 }, { alfie: true, seconds: 5 }], face: 0 }, 0);
  eq(G.advance(rot, 0, () => ({ skip: true })), { id: null, next: "a", appear: true }, "a skipping screen hands over to an Alfie step");
}

// The vector feed: pixels to [-1, 1] with y up, repeats dropped, faint strokes not sent.
{
  eq(G.vectorStroke([[0, 0], [100, 50], [100, 50], [200, 100]], false, 0.5, 200, 100),
    { p: [[-1, 1], [0, 0], [1, -1]], c: false, w: 0.5 }, "corner to centre to corner, y up, repeat dropped");
  eq(G.vectorStroke([[10, 10], [20, 10], [15, 20]], true, 2, 100, 100).c, true, "a closed triangle stays closed");
  eq(G.vectorStroke([[10, 10], [20, 10], [15, 20]], true, 2, 100, 100).w, 1, "weight capped at 1");
  eq(G.vectorStroke([[10, 10], [10, 10]], true, 1, 100, 100), { p: [[-0.8, 0.8], [-0.799, 0.8]], c: false, w: 1 }, "a dot is never closed, and goes as the shortest line");
  eq(G.vectorStroke([[10, 10]], false, 0.001, 100, 100), null, "too faint to send");
  eq(G.vectorStroke([[100 / 3, 0]], false, 1, 100, 100).p[0], [-0.333, 1], "rounded to 3 decimals");
}

// Non-finite points are dropped, not sent: xy-bench refuses a frame with one.
eq(G.vectorStroke([[0, 0], [NaN, 5], [100, 100]], false, 1, 100, 100).p, [[-1, 1], [1, -1]], "a NaN point dropped");
eq(G.vectorStroke([[NaN, 0]], false, 1, 100, 100), null, "nothing left to send");
eq(G.vectorStroke([[100 / 3, 0]], false, 1, 100, 100).p.length, 2, "a dot goes as two points (xy-bench drops one-point strokes)");

// The scope's tour: short jumps, open strokes turned, loops re-started, kept steady.
{
  const jumps = (st) => st.reduce((j, a, k) => {
    const b = st[(k + 1) % st.length];
    return j + Math.hypot(...[0, 1].map((i) => (a.c ? a.p[0] : a.p[a.p.length - 1])[i] - b.p[0][i]));
  }, 0);
  const line = (x0, x1, y) => ({ p: [[x0, y], [x1, y]], c: false, w: 1 });
  // Four rungs drawn in a bad order, every other one backwards.
  const rungs = [line(-1, 1, 0.9), line(-1, 1, -0.9), line(1, -1, 0.3), line(1, -1, -0.3)];
  const memo = new Map();
  const t = G.tourStrokes(rungs, memo);
  ok(jumps(t) < jumps(rungs) * 0.75, "rungs toured shorter");
  eq(t.length, 4, "every stroke kept");
  eq(t.map((s) => s.p[0][1]).sort((a, b) => a - b), [-0.9, -0.3, 0.3, 0.9], "each rung once");
  ok(t.every((s, k) => k === 0 || Math.abs(s.p[0][0] - t[k - 1].p[1][0]) < 1e-9),
     "a zigzag: each rung starts where the last one ended");
  // A loop is entered at its vertex nearest the beam.
  const ring = { p: Array.from({ length: 12 }, (_, i) => [Math.cos(i * Math.PI / 6) * 0.2, Math.sin(i * Math.PI / 6) * 0.2]), c: true, w: 1 };
  const r = G.tourStrokes([line(-1, -0.5, 0), ring, line(0.5, 1, 0)]).find((s) => s.c);
  ok(Math.abs(Math.abs(r.p[0][0]) - 0.2) < 1e-9 && Math.abs(r.p[0][1]) < 1e-9, "the ring entered at a side, not anywhere");
  // The same kind of frame keeps its order while it stays good, even when re-checked.
  const order = (st) => st.map((s) => s.p[0][1].toFixed(1)).join();
  const moved = rungs.map((s) => ({ ...s, p: s.p.map(([x, y]) => [x, y + 0.01]) }));
  const before = order(t);
  for (let i = 0; i < 40; i++) ok(order(G.tourStrokes(moved, memo)).replace(/\d/g, "") === before.replace(/\d/g, ""), "a nudged frame keeps its order");
  eq(memo.size, 1, "one kind of frame, one plan");
  G.tourStrokes(rungs.slice(0, 3), memo);
  eq(memo.size, 2, "a new kind of frame gets a plan of its own");
  // A kept order that has gone bad is replaced at the next re-check.
  // The same strokes listed in another order: the kept plan now tours them badly.
  const shuffled = [rungs[2], rungs[0], rungs[3], rungs[1]];

  let last;
  for (let i = 0; i < 20; i++) last = G.tourStrokes(shuffled, memo);
  near(jumps(last), jumps(t), "a stale order is re-solved", 1e-6);
  // A moving loop keeps its entry: an eye glancing doesn't make the jump hop round it.
  const eye = (x) => ({ p: Array.from({ length: 24 }, (_, i) => [x + 0.1 * Math.cos(i * Math.PI / 12), 0.1 * Math.sin(i * Math.PI / 12)]), c: true, w: 1 });
  const head = { p: Array.from({ length: 48 }, (_, i) => [0.8 * Math.cos(i * Math.PI / 24), 0.8 * Math.sin(i * Math.PI / 24)]), c: true, w: 1 };
  // An eye glancing under a mark: the nearest way in to it turns as it moves.
  const fm = new Map(), mark = { p: [[0, 0.5], [0.001, 0.5]], c: false, w: 1 };
  const rel = [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].map((dx) => {
    const e = G.tourStrokes([mark, eye(dx)], fm).find((s) => s.c);
    return [e.p[0][0] - dx, e.p[0][1]];
  });
  ok(rel.every((r) => Math.abs(r[0] - rel[0][0]) < 1e-9 && Math.abs(r[1] - rel[0][1]) < 1e-9), "the eye is entered at the same spot on it as it glances");
  // But a loop that has moved far is entered afresh.
  const far = G.tourStrokes([mark, { ...eye(0), p: eye(0).p.map(([x, y]) => [x, y + 1]) }], fm).find((s) => s.c);
  ok(far.p[0][1] < 1, "a loop moved past the mark is entered from below");
  // Loops go out open, ending where they start, so xy-bench can't re-pick their entry.
  const opened = G.openLoops([ring, line(0, 1, 0)]);
  ok(!opened[0].c && opened[0].p.length === 13 && opened[0].p[12] === ring.p[0], "a loop goes as an open stroke back to its start");
  eq(opened[1], line(0, 1, 0), "an open stroke is left alone");
  // Mid-transition: the order is kept, loops' entries still chosen and held.
  const pm = new Map(), pl = G.placeStrokes([line(-1, -0.5, 0), ring, line(0.5, 1, 0)], pm);
  eq(pl.map((s) => s.c), [false, true, false], "placeStrokes keeps the order");
  ok(Math.abs(pl[1].p[0][0]) > 0.19, "and enters the loop at a side");
  eq(G.tourStrokes([]), [], "no strokes");
  eq(G.tourStrokes([ring]), [ring], "one stroke untouched");
}

console.log(`stage: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
