// Transitions between Alfie and a screen (docs/screens-contract.md "Intros").
// Ported from xy-bench intros.py. The card calls three things:
//
//   presence(style, u, leaving)    u in [0,1] -> how present the arriving thing is,
//                                  0 gone .. 1 there (back-eased styles overshoot)
//   apply(style, p, leaving, strokes, box, from?, opts?) -> {strokes, alpha}
//   SECONDS[style]                 how long u takes to run 0..1
//
// An exit is the intro with presence reversed (`presence(.., leaving=true)` eases
// 1-u, so a zoom's overshoot becomes the wind-up before it leaves). slide, flip
// and wipe keep their direction when leaving: in from the left, out to the right.
//
// `strokes` are contract strokes in the screen box (`box` = {w, h} half extents;
// null is fine, the drawing's own extent is used). The returned strokes are new
// or the same objects; treat them as read only and valid until the next call.
// Alpha is what to draw them at (0..1); at p <= 0 it is 0, so nothing shows.
//
// ADDITIVE `from` (only morph reads it): the drawing the screen melts out of, or
// into when leaving, as contract strokes in the SAME box units as `strokes`.
// The card must pass the face as strokes: `I.faceStrokes(shapes)` where `shapes`
// is the {head, left, right} that `_frame()` returns (unit face coordinates, so
// scale them to the box if the face is not full size). Without `from`, morph
// grows the drawing from a dot at the centre. Because the morph IS the face
// turning into the screen, the face must not also be drawn: use
// `faceAlpha(style, p)` for the face instead of apply(...).alpha. For the other
// shaped styles the card may run the face through apply too:
// `apply(style, 1 - clamp(p), !leaving, faceStrokes(shapes), box)` (the face
// leaves as the screen arrives, so the direction flag is flipped).

export const STYLES = ["cut", "fade", "draw", "stagger", "zoom", "power_on", "slide", "flip",
  "wipe", "tune", "materialise", "condense", "morph"];
// What "random" should pick from: everything that is a real transition.
export const RANDOM_STYLES = STYLES.filter((s) => s !== "cut");
export const SECONDS = {
  cut: 0, fade: 0.6, draw: 1.2, stagger: 1.4, zoom: 0.9, power_on: 1.0, slide: 1.0,
  flip: 1.0, wipe: 1.2, tune: 1.4, materialise: 1.6, condense: 1.8, morph: 1.4,
};
// An exit is quicker than an entrance (xy OUTRO_SHARE); the card may scale by it.
export const OUTRO_SHARE = 0.6;

const num = (v) => (Number.isFinite(v) ? v : 0);
const clamp01 = (v) => Math.max(0, Math.min(1, num(v)));
const smooth = (u) => u * u * (3 - 2 * u);
const easeOut = (t) => 1 - (1 - t) ** 2;
const back = (t, c = 1.5) => { t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };
const EASE = {
  zoom: back, slide: back, flip: back, wipe: smooth, fade: smooth, morph: smooth,
  tune: (t) => t, condense: (t) => 1 - (1 - t) ** 3,
};

export function presence(style, u, leaving = false) {
  u = clamp01(u);
  if (style === "cut") { const p = u >= 1 ? 1 : 0; return leaving ? 1 - p : p; }
  return (EASE[style] || easeOut)(leaving ? 1 - u : u);
}

// How visible the face is while a screen arrives with presence `p`.
export function faceAlpha(style, p) {
  if (style === "morph") return p <= 0 ? 1 : 0;
  return apply(style, 1 - clamp01(p), false, EMPTY, null).alpha;
}

// ------------------------------------------------------------------ helpers

const EMPTY = [];
// Ramp-in of alpha from p = 0 so a style never shows a bright speck at the start.
const RAMP = { tune: 2.5, power_on: 20, materialise: 6, condense: 6 };

function extent(strokes, box) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of strokes) for (const q of s.pts) {
    if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0];
    if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1];
  }
  if (x0 > x1) { x0 = x1 = y0 = y1 = 0; }
  return {
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, x0, x1, y0, y1,
    bw: box?.w > 0 ? box.w : Math.max(Math.abs(x0), Math.abs(x1), 0.1),
    bh: box?.h > 0 ? box.h : Math.max(Math.abs(y0), Math.abs(y1), 0.1),
  };
}

// A filled icon's `group` (filled as one shape) only survives on a closed piece.
const piece = (s, pts, closed = false) => ({ pts, closed, w: s.w, role: s.role, fill: closed && s.fill,
  ...(closed && s.group ? { group: s.group, solid: s.solid } : {}) });
const mapStrokes = (strokes, f, wmul = null) => strokes.map((s) => {
  const o = piece(s, s.pts.map(f), s.closed);
  if (wmul) o.w = s.w * wmul;
  return o;
});

export function pathLength(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  if (closed && pts.length > 1) L += Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]);
  return L;
}

// The parts of `strokes` with lo <= x <= hi, in order. A cut loop becomes open runs.
function clipX(strokes, lo, hi) {
  const out = [];
  const inside = (q) => q[0] >= lo && q[0] <= hi;
  for (const s of strokes) {
    const src = s.pts;
    if (!src.length) continue;
    if (src.every(inside)) { out.push(s); continue; }
    const pts = s.closed ? src.concat([src[0]]) : src;
    let run = inside(pts[0]) ? [pts[0]] : [];
    const flush = () => { if (run.length > 1) out.push(piece(s, run)); run = []; };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0];
      if (dx !== 0) {
        const cuts = [];
        for (const e of [lo, hi]) if ((a[0] - e) * (b[0] - e) < 0) cuts.push([(e - a[0]) / dx, e]);
        cuts.sort((m, n) => m[0] - n[0]);
        for (const [t, e] of cuts) { run.push([e, a[1] + (b[1] - a[1]) * t]); if (run.length > 1) flush(); }
      }
      if (inside(b)) run.push(b); else flush();
    }
    flush();
  }
  return out;
}

// ---------------------------------------------------------------- reveal

// The strokes part-written: each drawn to `frac` of its length from where it
// was authored to start. `stagger` (0..0.95) starts them one after another, the
// last at that share of the way through; a stroke not yet started is left out.
export function reveal(strokes, frac, stagger = 0) {
  frac = clamp01(frac);
  stagger = Math.max(0, Math.min(0.95, num(stagger)));
  const out = [], n = strokes.length;
  for (let k = 0; k < n; k++) {
    const s = strokes[k];
    if (!s.pts.length) continue;
    let f = frac;
    if (stagger) f = clamp01((frac - (stagger * k) / Math.max(1, n - 1)) / (1 - stagger));
    if (f <= 0) continue;
    if (f >= 1) { out.push(s); continue; }
    if (s.pts.length === 1) { if (f >= 0.5) out.push(s); continue; }
    const pts = s.closed ? s.pts.concat([s.pts[0]]) : s.pts;
    let left = Math.max(1e-3, pathLength(pts, false) * f);
    const part = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d >= left) {
        const t = d ? left / d : 0;
        part.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
        break;
      }
      part.push(b);
      left -= d;
    }
    out.push(piece(s, part));
  }
  return out;
}

// ------------------------------------------------------------- resampler

let cumBuf = new Float64Array(256);
const cumOf = (pts) => {
  if (cumBuf.length < pts.length) cumBuf = new Float64Array(pts.length * 2);
  cumBuf[0] = 0;
  for (let i = 1; i < pts.length; i++) cumBuf[i] = cumBuf[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return cumBuf[pts.length - 1];
};

// Write `n` points evenly spaced by arc length along the open polyline `pts`
// into xs/ys at `off`. The first and last points are kept exactly.
function resampleInto(pts, n, xs, ys, off) {
  const m = pts.length;
  if (n <= 0) return;
  if (m === 0) { for (let i = 0; i < n; i++) { xs[off + i] = 0; ys[off + i] = 0; } return; }
  if (n === 1 || m === 1) { for (let i = 0; i < n; i++) { xs[off + i] = pts[0][0]; ys[off + i] = pts[0][1]; } return; }
  const L = cumOf(pts);
  let j = 0;
  for (let i = 0; i < n; i++) {
    if (i === n - 1) { xs[off + i] = pts[m - 1][0]; ys[off + i] = pts[m - 1][1]; break; }
    const s = (L * i) / (n - 1);
    while (j < m - 2 && cumBuf[j + 1] < s) j++;
    const seg = cumBuf[j + 1] - cumBuf[j], t = seg > 0 ? (s - cumBuf[j]) / seg : 0;
    xs[off + i] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t;
    ys[off + i] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t;
  }
}

// `n` points evenly spaced along the polyline; a closed one is walked back to
// its start (so the last point is the first again).
export function resample(pts, n, closed = false) {
  const src = closed && pts.length > 1 ? pts.concat([pts[0]]) : pts;
  const xs = new Float64Array(n), ys = new Float64Array(n);
  resampleInto(src, n, xs, ys, 0);
  return Array.from(xs, (x, i) => [x, ys[i]]);
}

// ------------------------------------------------------------- wobble etc.

function shaped(style, p, leaving, strokes, box) {
  const e = extent(strokes, box);
  switch (style) {
    case "draw": return reveal(strokes, p);
    case "stagger": return reveal(strokes, p, 0.6);
    case "zoom": {
      const k = Math.max(0.02, p);
      return mapStrokes(strokes, ([x, y]) => [e.cx + (x - e.cx) * k, e.cy + (y - e.cy) * k]);
    }
    case "power_on": {
      // A bright line across first, then it opens up (an old set warming up);
      // backwards, the squash to a line and a dot of switch-off.
      const q = clamp01(p);
      const sx = Math.max(0.03, easeOut(Math.min(1, q / 0.35))), sy = Math.max(0.004, (q - 0.35) / 0.65);
      return mapStrokes(strokes, ([x, y]) => [x * sx, y * sy], 1 + (1 - sy) * 0.8);
    }
    case "slide": {
      // The far edge starts a sliver inside, so there is always something on show.
      const span = e.x1 - e.x0, aspect = e.bw;
      const dx = leaving ? (1 - p) * (aspect - e.x0 - 0.03 * span) : -(1 - p) * (e.x1 + aspect - 0.03 * span);
      return clipX(mapStrokes(strokes, ([x, y]) => [x + dx, y]), -aspect, aspect);
    }
    case "flip": {
      // A card turning about the vertical axis, near edge bigger, carrying on
      // the way it turns when it leaves.
      const a = ((1 - p) * Math.PI / 2) * (leaving ? -1 : 1), c = Math.cos(a), s = Math.sin(a);
      return mapStrokes(strokes, ([x, y]) => { const d = 3 / (3 + x * s); return [x * c * d, y * d]; });
    }
    case "wipe": {
      // A bright edge sweeps left to right, the picture coming in behind it, or
      // going away in front of it.
      if (p >= 1) return strokes;
      const q = clamp01(p), A = e.bw, edge = -A + 2 * A * (leaving ? 1 - q : q);
      const kept = leaving ? clipX(strokes, edge, A + 1) : clipX(strokes, -A - 1, edge);
      kept.push({ pts: [[edge, -e.bh], [edge, e.bh]], closed: false, w: 1.5, role: "accent", fill: false });
      return kept;
    }
    case "tune": {
      // A station coming in on the dial: a wobble that dies away.
      const a = 0.22 * (1 - clamp01(p)) ** 1.5, w = 30 * (1 - clamp01(p));
      return mapStrokes(strokes, ([x, y]) => [x + a * Math.sin(7 * y + w), y + 0.5 * a * Math.sin(5 * x - w)]);
    }
    default: return strokes;
  }
}

// -------------------------------------------------------------- materialise

// Dots closing into lines: each stroke is cut into dashes at a fixed period,
// and the dashes grow from points until they touch. Capped so the card never
// draws more than ~420 pieces a frame.
function materialise(p, strokes) {
  let total = 0;
  for (const s of strokes) if (s.pts.length > 1 && s.w >= 0.3) total += pathLength(s.pts, s.closed);
  const P = Math.max(0.045, total / 420), q = smooth(clamp01(p));
  const L = P * q, out = [];
  for (const s of strokes) {
    if (s.pts.length < 2 || s.w < 0.3) { out.push(s); continue; }
    const pts = s.closed ? s.pts.concat([s.pts[0]]) : s.pts;
    const len = cumOf(pts);
    let j = 0;
    const at = (d) => {
      while (j < pts.length - 2 && cumBuf[j + 1] < d) j++;
      const seg = cumBuf[j + 1] - cumBuf[j], t = seg > 0 ? (d - cumBuf[j]) / seg : 0;
      return [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t];
    };
    for (let d0 = P / 2 - L / 2; d0 < len + 1e-9; d0 += P) {
      const a = Math.max(0, d0), b = Math.min(len, d0 + L);
      if (b < a) continue;
      if (L < 0.004 || b - a < 0.004) { out.push(piece(s, [at((a + b) / 2)])); continue; }
      const seg = [at(a)];
      for (let i = j + 1; i < pts.length && cumBuf[i] < b; i++) seg.push(pts[i]);
      seg.push(at(b));
      out.push(piece(s, seg));
    }
  }
  return out;
}

// ----------------------------------------------------------------- condense

// A fixed field of seeded dust (xy: 4096 grains, rng seed 1729): x, y in -1..1
// and the share of the transition a grain waits before it sets off.
const DUST = (() => {
  let a = 1729;
  const rnd = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const d = new Float32Array(4096 * 3);
  for (let i = 0; i < 4096; i++) { d[3 * i] = rnd() * 2 - 1; d[3 * i + 1] = rnd() * 2 - 1; d[3 * i + 2] = rnd() * 0.5; }
  return d;
})();
const LATE = 0.5;

// The point at arc length `at` along `path` (with cumulative lengths `cum`),
// searching on from segment `j`; returns [x, y, j] for the next search.
function arcAt(path, cum, at, j) {
  const m = path.length;
  while (j < m - 2 && cum[j + 1] < at) j++;
  const seg = cum[j + 1] - cum[j], t = seg > 0 ? Math.min(1, Math.max(0, (at - cum[j]) / seg)) : 0;
  return [path[j][0] + (path[j + 1][0] - path[j][0]) * t, path[j][1] + (path[j + 1][1] - path[j][1]) * t, j];
}

// `path` from arc length a to b, through its own corners.
function subPath(path, cum, a, b) {
  const p0 = arcAt(path, cum, a, 0), out = [[p0[0], p0[1]]];
  let j = p0[2];
  while (j + 1 < path.length - 1 && cum[j + 1] < b) { j++; out.push(path[j]); }
  const p1 = arcAt(path, cum, b, j);
  out.push([p1[0], p1[1]]);
  return out;
}

// Every grain of dust drifts in from a spot of its own, swirling, to its place
// on the strokes, the stragglers last. A grain in flight is a dot; grains in
// their places draw the stroke between them, through its own corners. So an
// arriving screen's dots join into lines as they land, and a leaving one
// stays whole lines that crumble as grains set off, with no field of dots first.
function condense(p, strokes, box) {
  let total = 0;
  for (const s of strokes) total += pathLength(s.pts, s.closed);
  if (!total) return strokes;
  const budget = Math.max(80, Math.min(360, Math.round(total / 0.025)));
  const e0 = extent(strokes, box);
  const rx = Math.max(0.1, e0.bw) * 1.1, ry = Math.max(0.1, e0.bh) * 1.1;
  const out = [];
  let i = 0;
  for (const s of strokes) {
    if (!s.pts.length) continue;
    const path = s.closed && s.pts.length > 1 ? s.pts.concat([s.pts[0]]) : s.pts;
    const m = path.length === 1 ? 1 : Math.max(2, Math.round((budget * pathLength(s.pts, s.closed)) / total));
    const cum = new Float64Array(path.length);
    for (let k = 1; k < path.length; k++) cum[k] = cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    const L = cum[path.length - 1], step = m > 1 ? L / (m - 1) : 0;
    let run = -1, j = 0;
    const flush = (end) => {
      if (run < 0) return;
      out.push(end > run && path.length > 1 ? piece(s, subPath(path, cum, run * step, end * step)) : piece(s, [arcAt(path, cum, run * step, 0).slice(0, 2)]));
      run = -1;
    };
    for (let k = 0; k < m; k++, i++) {
      const g = (i * 7 + 3) % 4096 * 3;   // a stride, so neighbours do not start side by side
      const q = clamp01((p - DUST[g + 2]) / (1 - LATE));
      if (q >= 1) { if (run < 0) run = k; continue; }
      flush(k - 1);
      const e = 1 - (1 - q) ** 3, a = (1 - e) * 2.5;
      const c = Math.cos(a), si = Math.sin(a), nx = DUST[g], ny = DUST[g + 1];
      const dx = (nx * c - ny * si) * rx, dy = (nx * si + ny * c) * ry;
      const t = path.length > 1 ? arcAt(path, cum, k * step, j) : [path[0][0], path[0][1], 0];
      j = t[2];
      out.push(piece(s, [[dx + (t[0] - dx) * e, dy + (t[1] - dy) * e]]));
    }
    // A stroke whose grains are all in place is the stroke itself (its fill too).
    if (run === 0) { out.push(s); continue; }
    flush(m - 1);
  }
  return out;
}

// The scope's condense, as xy-bench draws its own: each stroke resampled
// evenly, and every pair of samples a grain of dust drifting in to its place.
// The beam runs from grain to grain, so until they settle it draws lines
// between random points. Each stroke stays a stroke of its own, so the jumps
// between strokes stay jumps (faint, quick) and don't settle into solid lines
// just before the picture is whole.
function condenseLines(p, strokes) {
  let total = 0;
  for (const s of strokes) total += pathLength(s.pts, s.closed);
  if (!total) return strokes;
  const grains = Math.max(100, Math.min(450, Math.round(total / 0.02)));
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of strokes) for (const q of s.pts) {
    x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]);
  }
  const rx = Math.max(0.1, x1 - x0) / 2 * 1.2, ry = Math.max(0.1, y1 - y0) / 2 * 1.2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const out = [];
  let g0 = 0;
  for (const s of strokes) {
    if (!s.pts.length) continue;
    const path = s.closed && s.pts.length > 1 ? s.pts.concat([s.pts[0]]) : s.pts;
    const n = 2 * Math.max(1, Math.round((grains * pathLength(s.pts, s.closed)) / total));
    const xs = new Float64Array(n), ys = new Float64Array(n);
    resampleInto(path, n, xs, ys, 0);
    const cum = new Float64Array(path.length);
    for (let k = 1; k < path.length; k++) cum[k] = cum[k - 1] + Math.hypot(path[k][0] - path[k - 1][0], path[k][1] - path[k - 1][1]);
    const step = n > 1 ? cum[path.length - 1] / (n - 1) : 0;
    // Two neighbouring grains in their places draw the stroke between them through
    // its own corners: the evenly spaced samples alone would cut them, and the
    // picture would change shape the moment a transition starts or ends.
    const pts = [];
    let settled = 0, prevIn = false, v = 1;
    for (let i = 0; i < n; i++) {
      const g = (((g0 + i) >> 1) % 4096) * 3;
      const q = clamp01((p - DUST[g + 2]) / (1 - LATE));
      const inPlace = q >= 1;
      while (v < path.length - 1 && cum[v] <= (i - 1) * step) v++;
      if (inPlace && prevIn) for (; v < path.length - 1 && cum[v] < i * step; v++) pts.push(path[v]);
      if (inPlace) { settled++; pts.push([xs[i], ys[i]]); prevIn = true; continue; }
      prevIn = false;
      const e = 1 - (1 - q) ** 3, a = (1 - e) * 2.5;
      const c = Math.cos(a), si = Math.sin(a), nx = DUST[g], ny = DUST[g + 1];
      const dx = cx + (nx * c - ny * si) * rx, dy = cy + (nx * si + ny * c) * ry;
      pts.push([dx + (xs[i] - dx) * e, dy + (ys[i] - dy) * e]);
    }
    g0 += n;
    // All in place: the stroke itself (open, as the feed sends loops anyway).
    out.push(piece(s, settled === n && path.length > 1 ? path.slice() : pts));
  }
  return out;
}

// -------------------------------------------------------------------- morph

// Where in `b` to start and which way round to walk it so that each point of
// `a` moves a short way: found on coarse samples (xy align()).
export function align(a, b) {
  const K = a.x.length, m = Math.min(32, K);
  let best = [Infinity, 0, false];
  for (const rev of [false, true]) {
    for (let s = 0; s < m; s++) {
      let cost = 0;
      for (let k = 0; k < m; k++) {
        const ia = Math.floor((k * K) / m);
        const sh = Math.floor((s * K) / m), step = Math.floor((k * K) / m);
        const ib = (((rev ? sh - step : sh + step) % K) + K) % K;
        cost += Math.hypot(a.x[ia] - b.x[ib], a.y[ia] - b.y[ib]);
      }
      if (cost < best[0]) best = [cost, Math.floor((s * K) / m), rev];
    }
  }
  return { start: best[1], rev: best[2] };
}

// Stroke to stroke, not one long tour: the strokes of both drawings are ranked
// by length and the longest pair up (head to the longest line); a stroke left
// over grows or shrinks in place from a dot at its own centre. Each pair is resampled to the same count and blended point by point.
// A closed pair is aligned by cyclic shift (xy align()), an open one by
// direction. Beats xy's single-path blend for canvas: no jump streaks.
const DOT = [{ pts: [[0, 0]], closed: false, w: 1, role: "line", fill: false }];
const byLen = (strokes) => strokes.filter((s) => s.pts.length)
  .map((s) => ({ s, l: pathLength(s.pts, s.closed) })).sort((m, n) => n.l - m.l).map((o) => o.s);
const centreDot = (s) => {
  let x = 0, y = 0;
  for (const q of s.pts) { x += q[0]; y += q[1]; }
  return piece(s, [[x / s.pts.length, y / s.pts.length]]);
};

function morph(p, strokes, from) {
  if (p >= 1) return strokes;
  if (p <= 0 && from?.length) return from;
  const A = byLen(from?.length ? from : DOT), B = byLen(strokes.length ? strokes : DOT);
  const pairs = Math.max(A.length, B.length);
  const lens = [], PA = [], PB = [];
  let sum = 0;
  for (let i = 0; i < pairs; i++) {
    const a = A[i] || centreDot(B[i]), b = B[i] || centreDot(A[i]);
    PA.push(a); PB.push(b);
    const l = Math.max(pathLength(a.pts, a.closed), pathLength(b.pts, b.closed));
    lens.push(l);
    sum += l;
  }
  const scale = Math.min(1, 500 / Math.max(1, sum / 0.02));
  const out = [], useA = p < 0.5;
  for (let i = 0; i < pairs; i++) {
    const a = PA[i], b = PB[i];
    const both = a.closed && b.closed;
    const n = Math.max(a.pts.length === 1 && b.pts.length === 1 ? 1 : 3, Math.round((lens[i] / 0.02) * scale));
    const ra = a.pts.length > 1 ? resample(a.pts, both ? n + 1 : n, a.closed) : resample(a.pts, n);
    const rb = b.pts.length > 1 ? resample(b.pts, both ? n + 1 : n, b.closed) : resample(b.pts, n);
    if (both) { ra.pop(); rb.pop(); }
    const m = ra.length, X = (r) => Float64Array.from(r, (q) => q[0]), Y = (r) => Float64Array.from(r, (q) => q[1]);
    let start = 0, rev = false;
    if (both) ({ start, rev } = align({ x: X(ra), y: Y(ra) }, { x: X(rb), y: Y(rb) }));
    else {
      const d = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1]);
      rev = d(ra[0], rb[0]) + d(ra[m - 1], rb[m - 1]) > d(ra[0], rb[m - 1]) + d(ra[m - 1], rb[0]);
    }
    const pts = new Array(m);
    for (let k = 0; k < m; k++) {
      const ib = both ? (((rev ? start - k : start + k) % m) + m) % m : (rev ? m - 1 - k : k);
      pts[k] = [ra[k][0] + (rb[ib][0] - ra[k][0]) * p, ra[k][1] + (rb[ib][1] - ra[k][1]) * p];
    }
    out.push(piece(useA ? a : b, pts, both));
  }
  return out;
}

// ---------------------------------------------------------------------- apply

// `opts.lines`: condense as xy-bench's lines between random points (the
// oscilloscope feed), not dots.
export function apply(style, p, leaving, strokes, box, from = null, opts = null) {
  p = num(p);
  strokes = strokes || EMPTY;
  if (style === "cut") return { strokes, alpha: p >= 0.5 ? 1 : 0 };
  if (p <= 0 && !(style === "morph" && from?.length)) return { strokes: EMPTY, alpha: 0 };
  const ramp = RAMP[style] ?? 8;
  switch (style) {
    case "draw": case "stagger": case "zoom": case "power_on": case "slide":
    case "flip": case "wipe": case "tune":
      return { strokes: shaped(style, p, leaving, strokes, box), alpha: clamp01(p * ramp) };
    case "materialise":
      return { strokes: p >= 1 ? strokes : materialise(p, strokes), alpha: clamp01(p * ramp) };
    case "condense":
      return { strokes: p >= 1 ? strokes : opts?.lines ? condenseLines(p, strokes) : condense(p, strokes, box),
        alpha: clamp01(p * ramp) };
    case "morph":
      return { strokes: morph(clamp01(p), strokes, from), alpha: from?.length ? 1 : clamp01(p * 8) };
    default: return { strokes, alpha: clamp01(p) };   // fade, and anything unknown
  }
}

// The face as strokes, for morph's `from` or to run the face through apply:
// `shapes` is what the card's _frame() returns ({head, left, right} point lists
// in unit face coordinates). Head is role "line", the eyes "accent".
export function faceStrokes(shapes, scale = 1, cx = 0, cy = 0) {
  const f = ([x, y]) => [cx + x * scale, cy + y * scale];
  const mk = (pts, role) => ({ pts: pts.map(f), closed: true, w: 1, role, fill: false });
  return [mk(shapes.head, "line"), mk(shapes.left, "accent"), mk(shapes.right, "accent")];
}
