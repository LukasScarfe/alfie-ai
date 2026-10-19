// What a card has on show and where Alfie stands on it, as pure functions so
// node can test them (tests/stage.test.mjs). No DOM, no HA.
//
// Rotation: screen -> face -> (bad news: each wrong screen, then back with a
// shake) -> the next screen. Place: a story's move/resize, sprung toward.

export const BACK_SECONDS = 3;   // Alfie's time after bad news, shaking his head
export const HOME = { x: 0, y: 0, s: 1 };

export function start(spec, clock) {
  return { ...spec, idx: 0, phase: "screen", t0: clock, bad: [], badIdx: 0 };
}

// A fresh spec (the steps changed under a running rotation) that keeps its place.
export function carry(old, spec) {
  if (!old?.steps || !spec) return start(spec, old?.t0 ?? 0);
  return { ...spec, idx: old.idx % spec.steps.length, phase: old.phase, t0: old.t0,
    bad: old.bad, badIdx: old.badIdx };
}

function nextStep(rot) {
  rot.phase = "screen";
  rot.idx = (rot.idx + 1) % rot.steps.length;
}

function duration(rot, badSeconds) {
  switch (rot.phase) {
    case "screen": return Number(rot.steps[rot.idx].seconds);
    case "face": return Number(rot.face ?? 20);
    case "bad": return badSeconds;
    default: return BACK_SECONDS;
  }
}

// Move `rot` on to `clock` (rotation seconds). `badNow()` lists the wrong
// screens at the moment Alfie would tell them. Returns what is wanted now:
// {id, next, shake}, where id is a screen or null for Alfie, next is the
// screen to prefetch, and shake is true when he just came back from bad news.
export function advance(rot, clock, { badNews = true, badSeconds = 10, badNow = () => [] } = {}) {
  let shake = false;
  for (let guard = 0; guard < rot.steps.length * 4 + 8; guard++) {
    const dur = duration(rot, badSeconds);
    if (clock - rot.t0 < dur) break;
    rot.t0 += dur;
    if (rot.phase === "screen") {
      rot.phase = "face";
    } else if (rot.phase === "face") {
      const bad = badNews ? badNow() : [];
      if (bad.length) Object.assign(rot, { phase: "bad", bad, badIdx: 0 });
      else nextStep(rot);
    } else if (rot.phase === "bad") {
      if (rot.badIdx + 1 < rot.bad.length) rot.badIdx++;
      else { rot.phase = "back"; shake = true; }
    } else {
      nextStep(rot);
    }
  }
  const after = rot.steps[(rot.idx + 1) % rot.steps.length].screen;
  switch (rot.phase) {
    case "screen": return { id: rot.steps[rot.idx].screen, next: null, shake };
    case "bad": return { id: rot.bad[rot.badIdx], next: rot.bad[rot.badIdx + 1] ?? null, shake };
    default: return { id: null, next: after, shake };
  }
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
