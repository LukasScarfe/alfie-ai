// What a card has on show and where Alfie stands on it, as pure functions so
// node can test them (tests/stage.test.mjs). No DOM, no HA.
//
// Rotation: screens follow screens; Alfie stays as he is (gone, or in the
// corner). He appears only in an Alfie step ({alfie: true, seconds}), or
// between screens when the rotation's `face` seconds are over 0, and then
// plays the most relevant story locally (runStory). Place: a story's
// move/resize, sprung toward.

export const HOME = { x: 0, y: 0, s: 1 };

const isAlfie = (st) => !!st?.alfie;

export function start(spec, clock) {
  const alfie = isAlfie(spec.steps[0]);
  return { ...spec, idx: 0, phase: alfie ? "alfie" : "screen", t0: clock, hold: 0, appear: alfie };
}

// A fresh spec (the steps changed under a running rotation) that keeps its place.
export function carry(old, spec) {
  if (!old?.steps || !spec) return start(spec, old?.t0 ?? 0);
  const idx = old.idx % spec.steps.length;
  const phase = old.phase === "gap" ? "gap" : isAlfie(spec.steps[idx]) ? "alfie" : "screen";
  return { ...spec, idx, phase, t0: old.t0, hold: old.hold, appear: old.appear && phase !== "screen" };
}

// The phase after `rot`'s current one: the next step, or a gap of Alfie
// first when `face` asks for him between two screens.
function next(rot) {
  const n = rot.steps.length, j = (rot.idx + 1) % n;
  if (rot.phase === "screen" && Number(rot.face) > 0 && !isAlfie(rot.steps[j])) {
    rot.phase = "gap";
  } else {
    rot.idx = j;
    rot.phase = isAlfie(rot.steps[j]) ? "alfie" : "screen";
  }
  rot.hold = 0;
  rot.appear = rot.phase !== "screen";
}

// Alfie's phases last their seconds, or as long as his story when that is
// longer (`hold`, which the card sets once it knows the story).
function duration(rot) {
  const own = rot.phase === "gap" ? Number(rot.face) : Number(rot.steps[rot.idx].seconds);
  return rot.phase === "screen" ? own : Math.max(own, rot.hold || 0);
}

// Move `rot` on to `clock` (rotation seconds). Returns what is wanted now:
// {id, next, appear}, where id is a screen or null for Alfie, next is the
// screen to prefetch, and appear is true once, when Alfie comes on (the card
// then plays his story and sets rot.hold to its length).
export function advance(rot, clock) {
  for (let guard = 0; guard < rot.steps.length * 4 + 8; guard++) {
    if (clock - rot.t0 < duration(rot)) break;
    rot.t0 += duration(rot);
    next(rot);
  }
  const appear = rot.appear;
  rot.appear = false;
  let after = null;
  for (let k = 1; k <= rot.steps.length; k++) {
    const st = rot.steps[(rot.idx + k) % rot.steps.length];
    if (!isAlfie(st)) { after = st.screen; break; }
  }
  if (rot.phase === "screen") return { id: rot.steps[rot.idx].screen, next: after, appear };
  return { id: null, next: after, appear };
}

// A story's length in seconds: its actions back to back.
export const storyLength = (actions) => (actions || []).reduce((t, a) => t + (Number(a.seconds) || 0), 0);

// Where a story played on one card stands `to` seconds in: the last
// expression (with its blend) and place so far, the screen on show (only
// while its own action lasts, as in the engine), the animations that start
// in (from, to], and whether it is over. Mirrors engine._run_story.
export function runStory(actions, from, to) {
  const out = { expression: null, blend: 0, place: null, screen: null, fire: [], done: false };
  let t = 0;
  for (const a of actions || []) {
    if (t > to) break;
    const secs = Number(a.seconds) || 0;
    if (a.kind === "expression") { out.expression = a.value.name; out.blend = a.value.blend || 0; }
    else if (a.kind === "place") out.place = a.value;
    else if (a.kind === "animation" && t > from) out.fire.push(a.value);
    else if (a.kind === "screen" && to < t + secs) out.screen = a.value;
    t += secs;
  }
  out.done = to >= t;
  return out;
}

// When the story screen on show at `at` ends, if it ends in (at, to]: the card
// stops the story there, so what follows waits for the screen to leave.
export function screenEnd(actions, at, to) {
  let t = 0;
  for (const a of actions || []) {
    const end = t + (Number(a.seconds) || 0);
    if (a.kind === "screen" && t <= at && at < end) return to >= end ? end : null;
    t = end;
  }
  return null;
}

// One frame of springing from `cur` ({x, y, s}) toward a story's `target`
// ({x, y, scale, seconds}, or null for home). Settles in about `seconds`.
export function placeToward(cur, target, dt) {
  const t = target ?? { x: 0, y: 0, scale: 1, seconds: 0.8 };
  const tau = Math.max(Number(t.seconds) || 0, 0.05) / 3;
  const k = 1 - Math.exp(-Math.max(dt, 0) / tau);
  const s = Number(t.scale ?? 1);
  return { x: cur.x + (t.x - cur.x) * k, y: cur.y + (t.y - cur.y) * k, s: cur.s + (s - cur.s) * k };
}

export const atHome = (p) => Math.abs(p.x) < 1e-3 && Math.abs(p.y) < 1e-3 && Math.abs(p.s - 1) < 1e-3;

// Where a place puts the face on a w x h canvas whose full-size ring has
// radius R px: x and y of +-1 put the ring against the edges, y up.
export function placeAt(p, w, h, R) {
  const r = R * p.s * 1.02;
  return { cx: w / 2 + p.x * Math.max(0, w / 2 - r), cy: h / 2 - p.y * Math.max(0, h / 2 - r), s: p.s };
}
