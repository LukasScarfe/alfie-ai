// What a card has on show and where Alfie stands on it, as pure functions so
// node can test them (tests/stage.test.mjs). No DOM, no HA.
//
// Rotation: screens follow screens; Alfie stays as he is (gone, or in the
// corner). He appears only in an Alfie step ({alfie: true, seconds}), or
// between screens when the rotation's `face` seconds are over 0, and then
// plays the most relevant story locally (runStory). A screen may have a say
// in its turn (`fit`): skip it while it has nothing to show, or lengthen it.
// Place: a story's move/resize, sprung toward.

export const HOME = { x: 0, y: 0, s: 1 };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const isAlfie = (st) => !!st?.alfie;

export function start(spec, clock) {
  const alfie = isAlfie(spec.steps[0]);
  return { ...spec, idx: 0, phase: alfie ? "alfie" : "screen", t0: clock, hold: 0, appear: alfie, len: null };
}

// A fresh spec (the steps changed under a running rotation) that keeps its place.
export function carry(old, spec) {
  if (!old?.steps || !spec) return start(spec, old?.t0 ?? 0);
  const idx = old.idx % spec.steps.length;
  const phase = old.phase === "gap" ? "gap" : isAlfie(spec.steps[idx]) ? "alfie" : "screen";
  return { ...spec, idx, phase, t0: old.t0, hold: old.hold, appear: old.appear && phase !== "screen", len: old.len ?? null };
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
  rot.len = null;
  rot.appear = rot.phase !== "screen";
}

// Alfie's phases last their seconds, or as long as his story when that is
// longer (`hold`, which the card sets once it knows the story).
function duration(rot) {
  const own = rot.phase === "gap" ? Number(rot.face) : Number(rot.steps[rot.idx].seconds);
  return rot.phase === "screen" ? rot.len ?? own : Math.max(own, rot.hold || 0);
}

// How often an all-skipping rotation looks again, in rotation seconds.
export const SKIP_RECHECK = 1;

// Move `rot` on to `clock` (rotation seconds). Returns what is wanted now:
// {id, next, appear}, where id is a screen or null for Alfie, next is the
// screen to prefetch, and appear is true once, when Alfie comes on (the card
// then plays his story and sets rot.hold to its length).
// `fit(screen)` -> {skip, seconds} | null is asked once as a screen's turn
// starts: skip passes it over at no time cost (no gap of Alfie either), and
// seconds lengthens the turn past the step's own. When every screen skips,
// Alfie has the stage and the rotation looks again every SKIP_RECHECK s.
export function advance(rot, clock, fit = null) {
  let skipped = 0;
  for (let guard = 0; guard < rot.steps.length * 4 + 8; guard++) {
    if (rot.phase === "screen" && rot.len == null) {
      if (rot.idle > clock) return { id: null, next: null, appear: false };
      const st = rot.steps[rot.idx], f = fit ? fit(st.screen) : null;
      if (f?.skip) {
        rot.phase = "skip";   // so `next` adds no gap of Alfie
        next(rot);
        if (++skipped >= rot.steps.length) {   // round to where it started, and wait
          rot.t0 = clock; rot.idle = clock + SKIP_RECHECK;
          return { id: null, next: null, appear: false };
        }
        continue;
      }
      rot.len = Math.max(Number(st.seconds), Number(f?.seconds) || 0);
      if (rot.idle) { rot.t0 = clock; rot.idle = 0; }   // back from waiting: a full turn from now
    }
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
// while its own action lasts, as in the engine), the animations and icon
// badges that start in (from, to], and whether it is over. Mirrors engine._run_story.
export function runStory(actions, from, to) {
  const out = { expression: null, blend: 0, place: null, screen: null, fire: [], icons: [], done: false };
  let t = 0;
  for (const a of actions || []) {
    if (t > to) break;
    const secs = Number(a.seconds) || 0;
    if (a.kind === "expression") { out.expression = a.value.name; out.blend = a.value.blend || 0; }
    else if (a.kind === "place") out.place = a.value;
    else if (a.kind === "animation" && t > from) out.fire.push(a.value);
    else if (a.kind === "icon" && t > from) out.icons.push(a.value);
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

// ------------------------------------------------------------------- icons
// design.md "Icons". The same as stories.icon_action, for an icon played on one
// card only (the panel's Try it): transform and beside are screens with the
// icon on them, an overlay is a badge.
export const ICON_SCREEN = "@icon";
export function iconAction(icon, wait = true) {
  const i = { icon: "mdi:lightbulb-on", style: "transform", transform: "whole", seconds: 5, transition: "",
    corner: "card", place: "top_right", x: 0, y: 0, size: 1, color: "line", fill: "soft", ...(icon || {}) };
  const look = { name: i.icon, size: Number(i.size) || 1, color: i.color, fill: i.fill };
  const secs = Number(i.seconds) || 5;
  if (i.style === "overlay") {
    return { kind: "icon", value: { ...look, place: i.place, x: Number(i.x) || 0, y: Number(i.y) || 0, seconds: secs, transition: i.transition }, seconds: wait ? secs : 0 };
  }
  const value = i.style === "transform"
    ? { id: ICON_SCREEN, icon: { ...look, ring: i.transform === "ring" }, seconds: secs, present: "handover", transition: "morph" }
    : { id: ICON_SCREEN, icon: { ...look, corner: i.corner }, seconds: secs, present: "corner", transition: i.transition };
  return { kind: "screen", value, seconds: secs };
}

export const BADGE = 0.35;   // a badge's half size at size 1, in ring radii

// Where a badge goes, in canvas px: its centre and half size. `face` is where
// Alfie is drawn ({cx, cy, r} px), `m` the card's margin; y is up for custom.
// Beside him (above, below, left, right) it sits just off his ring, kept on the card.
export function badgeAt(b, w, h, R, face, m) {
  const s = R * BADGE * clamp(Number(b.size) || 1, 0.3, 2);
  const lo = m + s, hi = (n) => n - m - s;
  const fit = (v, n) => (hi(n) < lo ? n / 2 : Math.max(lo, Math.min(hi(n), v)));
  const gap = s * 0.25 + face.r;
  let x = w / 2, y = h / 2;
  switch (b.place) {
    case "above": x = face.cx; y = face.cy - gap - s; break;
    case "below": x = face.cx; y = face.cy + gap + s; break;
    case "left": x = face.cx - gap - s; y = face.cy; break;
    case "right": x = face.cx + gap + s; y = face.cy; break;
    case "top_left": x = lo; y = lo; break;
    case "top_right": x = hi(w); y = lo; break;
    case "bottom_left": x = lo; y = hi(h); break;
    case "bottom_right": x = hi(w); y = hi(h); break;
    case "custom":
      x = w / 2 + clamp(Number(b.x) || 0, -1, 1) * Math.max(0, w / 2 - m - s);
      y = h / 2 - clamp(Number(b.y) || 0, -1, 1) * Math.max(0, h / 2 - m - s);
      break;
    default: break;   // centre
  }
  return { cx: fit(x, w), cy: fit(y, h), s };
}
