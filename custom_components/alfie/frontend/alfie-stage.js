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

// One painted stroke for the vector feed (the oscilloscope): canvas pixels to
// [-1, 1] across a w x h canvas, y up, rounded, repeats dropped. `weight` is
// how bright it should be (its alpha), since on a scope brightness is how long
// the beam dwells; null for a stroke too faint to send.
export function vectorStroke(pts, closed, weight, w, h) {
  if (!(weight > 0.003) || !pts?.length) return null;
  const r = (n) => Math.round(n * 1000) / 1000;
  const p = [];
  for (const [x, y] of pts) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;   // xy-bench refuses a frame with one
    const q = [r((2 * x) / w - 1), r(1 - (2 * y) / h)];
    const last = p[p.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) p.push(q);
  }
  if (!p.length) return null;
  // A dot is sent as the shortest of lines: xy-bench drops one-point strokes.
  if (p.length === 1) p.push([r(p[0][0] + 0.001), p[0][1]]);
  return { p, c: !!closed && p.length > 2, w: r(clamp(weight, 0, 1)) };
}

// The order the scope's beam takes through a frame's strokes. There is no
// blanking on an X-Y scope: every jump from one stroke to the next is a real
// line the beam draws, and it costs samples the strokes could have had. So the
// strokes go out as a short closed tour (the wrap from last to first counts),
// each open stroke turned the way the beam arrives and each loop re-started at
// the vertex nearest it. xy-bench traces them in this order (`ordered`).
//
// A frame's tour is kept and only solved afresh when the kept one has grown
// TOUR_SLACK longer than it was (checked at most every TOUR_RECHECK frames),
// so moving parts don't make the order, and the jumps, flicker. Plans are
// kept per kind of frame (its count of open and closed strokes, in order) in
// `memo`, a Map the caller holds, so a screen whose strokes come and go
// (smoke, a ticking hand) doesn't re-solve each time. Returns the strokes.
const TOUR_SLACK = 1.15;
const TOUR_RECHECK = 15;
const TOUR_KINDS = 16;    // plans kept per memo
const TOUR_STARTS = 24;   // greedy starts tried per solve
const LOOP_PORTS = 24;    // a loop's vertices considered while solving

const dist = (a, b) => { const x = a[0] - b[0], y = a[1] - b[1]; return Math.sqrt(x * x + y * y); };   // not Math.hypot: slow in V8

// Strokes in `order` ([index, reversed] pairs), open ones turned as it says
// and each loop re-started at the vertex that makes the jumps in and out of
// it shortest (a loop leaves where it entered). `was` holds each loop's entry
// from the last frame, as a share of the way round; it is kept unless moving
// saves LOOP_HOLD, so a loop that moves (an eye glancing) keeps its entry and
// the jump lines to it follow it rather than hop round it. Returns the placed
// strokes, the tour's total jump length and the entries (`ent`).
const LOOP_HOLD = 0.15;

function placeTour(strokes, order, was = null) {
  const src = order.map(([i, r]) => (r && !strokes[i].c ? { ...strokes[i], p: strokes[i].p.slice().reverse() } : strokes[i]));
  const n = src.length;
  const held = (k) => src[k].c && was?.[k] != null;
  const start = src.map((s, k) => (held(k) ? Math.round(was[k] * s.p.length) % s.p.length : 0));
  const entry = (k) => src[k].p[start[k]];
  const exit = (k) => (src[k].c ? entry(k) : src[k].p[src[k].p.length - 1]);
  // Twice round: a loop's neighbours may be loops that move on the first pass.
  for (let pass = 0; pass < 2 && n > 1; pass++) {
    for (let k = 0; k < n; k++) {
      const s = src[k];
      if (!s.c) continue;
      const a = exit((k + n - 1) % n), b = entry((k + 1) % n);
      let j = 0, best = Infinity;
      for (let m = 0; m < s.p.length; m++) {
        const d = dist(s.p[m], a) + dist(s.p[m], b);
        if (d < best) { best = d; j = m; }
      }
      const q = s.p[start[k]];
      if (!held(k) || dist(q, a) + dist(q, b) > best + LOOP_HOLD) start[k] = j;
    }
  }
  const out = src.map((s, k) => (start[k] ? { ...s, p: s.p.slice(start[k]).concat(s.p.slice(0, start[k])) } : s));
  let cost = 0;
  for (let k = 0; n > 1 && k < n; k++) cost += dist(exit(k), entry((k + 1) % n));
  return { out, cost, ent: src.map((s, k) => (s.c ? start[k] / s.p.length : null)) };
}

// A fresh order: a greedy nearest-entry walk from several starts, each tidied
// by 2-opt (a reversed run of strokes is traced backwards, open ones flipped).
function solveTour(strokes) {
  const n = strokes.length;
  const ports = strokes.map((s) => {
    if (!s.c) return null;
    const step = Math.max(1, Math.floor(s.p.length / LOOP_PORTS));
    return s.p.filter((_, j) => j % step === 0);
  });
  let best = null, bestCost = Infinity;
  // Fewer starts on a crowded frame: each is a walk over every pair.
  const starts = Math.max(1, Math.min(n, TOUR_STARTS, Math.floor(2000 / n)));
  for (let k = 0; k < starts; k++) {
    const first = Math.floor((k * n) / starts);
    // ends[i] = [entry, exit] of the i-th stroke of the tour, as placed.
    const order = [first], ends = [];
    const left = new Set(strokes.keys()); left.delete(first);
    const s0 = strokes[first];
    ends.push(s0.c ? [s0.p[0], s0.p[0]] : [s0.p[0], s0.p[s0.p.length - 1]]);
    let at = ends[0][1];
    while (left.size) {
      let pick = -1, pe = null, d = Infinity;
      for (const i of left) {
        const s = strokes[i];
        if (s.c) {
          for (const v of ports[i]) { const e = dist(v, at); if (e < d) { d = e; pick = i; pe = [v, v]; } }
        } else {
          const a = s.p[0], b = s.p[s.p.length - 1];
          const da = dist(a, at), db = dist(b, at);
          if (da < d) { d = da; pick = i; pe = [a, b]; }
          if (db < d) { d = db; pick = i; pe = [b, a]; }
        }
      }
      left.delete(pick); order.push(pick); ends.push(pe); at = pe[1];
    }
    twoOpt(order, ends);
    let cost = 0;
    for (let x = 0; x < n; x++) cost += dist(ends[x][1], ends[(x + 1) % n][0]);
    // A stroke runs backwards when the tour enters it at its last point.
    if (cost < bestCost - 1e-9) { best = order.map((i, x) => [i, !strokes[i].c && ends[x][0] !== strokes[i].p[0]]); bestCost = cost; }
  }
  return best;
}

// 2-opt on a closed tour of oriented strokes: reversing the run i..j swaps
// each stroke's entry and exit, so the joins at both ends of the run change.
function twoOpt(order, ends) {
  const n = order.length;
  if (n < 3) return;
  for (let pass = 0, better = true; better && pass < 20; pass++) {
    better = false;
    for (let i = 1; i < n - 1; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = ends[i - 1][1], b = ends[i][0], c = ends[j][1], d = ends[(j + 1) % n][0];
        if (dist(a, c) + dist(b, d) < dist(a, b) + dist(c, d) - 1e-9) {
          for (let x = i, y = j; x < y; x++, y--) {
            [order[x], order[y]] = [order[y], order[x]];
            [ends[x], ends[y]] = [ends[y], ends[x]];
          }
          for (let x = i; x <= j; x++) ends[x] = [ends[x][1], ends[x][0]];
          better = true;
        }
      }
    }
  }
}

export function tourStrokes(strokes, memo = null) {
  const n = strokes.length;
  if (n < 2) return strokes;
  const sig = strokes.map((st) => (st.c ? "c" : "o")).join("");
  const plan = memo?.get(sig);
  if (plan?.order) {
    const kept = placeTour(strokes, plan.order, plan.ent);
    plan.age++;
    plan.ent = kept.ent;
    if (kept.cost <= plan.cost * TOUR_SLACK + 0.02 || plan.age < TOUR_RECHECK) return kept.out;
    plan.age = 0;
    const order = solveTour(strokes), fresh = placeTour(strokes, order);
    if (fresh.cost * TOUR_SLACK < kept.cost) { Object.assign(plan, { order, cost: fresh.cost, ent: fresh.ent }); return fresh.out; }
    plan.cost = kept.cost;   // the layout moved, but no better tour is to be had
    return kept.out;
  }
  const order = solveTour(strokes), fresh = placeTour(strokes, order);
  remember(memo, sig, { order, cost: fresh.cost, age: 0, ent: fresh.ent });
  return fresh.out;
}

function remember(memo, sig, plan) {
  if (!memo) return;
  if (memo.size >= TOUR_KINDS) memo.delete(memo.keys().next().value);
  memo.set(sig, plan);
}

// The strokes in the order given, only each loop's entry chosen (and held, as
// placeTour holds it): for a frame mid-transition, whose order is already set.
// `memo` is the caller's Map, kept apart from a tourStrokes one.
export function placeStrokes(strokes, memo = null) {
  if (strokes.length < 2) return strokes;
  const sig = strokes.map((st) => (st.c ? "c" : "o")).join("");
  const plan = memo?.get(sig);
  const r = placeTour(strokes, strokes.map((_, i) => [i, false]), plan?.ent);
  if (plan) plan.ent = r.ent; else remember(memo, sig, { ent: r.ent });
  return r.out;
}

// Loops sent as open strokes that end where they start. xy-bench re-picks a
// closed stroke's entry every frame, nearest the beam, and so would move the
// jumps about; an open one it only turns, and a loop's two ways are the same.
export function openLoops(strokes) {
  return strokes.map((st) => (st.c ? { ...st, p: st.p.concat([st.p[0]]), c: false } : st));
}
