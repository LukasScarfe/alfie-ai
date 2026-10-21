// Alfie's face maths: pure functions, no DOM, so node can test them against
// xy-bench's own numbers (tests/golden_face.json). Ported from xy-bench
// figures.py; the names follow it so the two can be read side by side.
//
// Units are ring radii, y up. A pose is a flat array, so a blend is a lerp:
//   [hu, su, hl, sl] left eye lids, the same for the right, size, look x, y.
// Lids are straight lines y = h + s*u in eye radii, u pointing to the nose.

export const GEOMETRY = {
  eye_x: 0.42, eye_r: 0.25, eye_sides: 120, ring_res: 120, blend: 0.8,
  damping: 0.45, spring: 11.7, blink: 0.16, blink_slot: 5.0, droop_line: 0.1,
};

export function ease(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

export function cut(t) {
  return t > 0 ? 1 : 0;
}

// A damped spring's step response that lands exactly at 1: its last wobble
// fades out over the final 40%. `z` and `w` default to xy-bench's; the card
// raises z when Alfie is low on energy, so a sad blend stops bouncing.
export function spring(t, z = GEOMETRY.damping, w = GEOMETRY.spring) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const wd = w * Math.sqrt(1 - z * z);
  const left = Math.exp(-z * w * t) * (Math.cos(wd * t) + (z * w / wd) * Math.sin(wd * t));
  return 1 - left * (1 - ease((t - 0.6) / 0.4));
}

export const EASES = { ease, spring: (t) => spring(t), cut, linear: (t) => Math.max(0, Math.min(1, t)) };

// The fractional part as Python's % 1.0 gives it (always >= 0).
function frac(x) {
  return x - Math.floor(x);
}

// How shut a blink has the eyes at `t` seconds: one per slot, at a place that
// looks random but is the same every time.
export function blink(t, slot = GEOMETRY.blink_slot, length = GEOMETRY.blink) {
  const n = Math.floor(t / slot);
  const at = n * slot + 0.5 + (slot - 1.5) * frac(Math.sin(n * 12.9898) * 43758.5453);
  const x = (t - at) / length;
  return x >= 0 && x <= 1 ? Math.sin(Math.PI * x) : 0;
}

export function rand(n, salt) {
  return 2 * frac(Math.sin(n * 12.9898 + salt * 78.233) * 43758.5453) - 1;
}

export function poseOf(expr) {
  return [...expr.left, ...(expr.right || expr.left), expr.size ?? 1, ...(expr.look || [0, 0])];
}

export function lerp(a, b, f) {
  return a.map((v, i) => v + (b[i] - v) * f);
}

// Lids an overshoot pushed past each other are made to meet instead, so a
// bounce into a shut eye flattens it rather than turning it inside out.
export function uncrossed(pose) {
  const out = pose.slice();
  for (const e of [0, 4]) {
    const [hu, su, hl, sl] = pose.slice(e, e + 4);
    const ends = [-1, 1].map((u) => {
      let up = hu + su * u, down = hl + sl * u;
      if (up < down) up = down = (up + down) / 2;
      return [up, down];
    });
    const [[u0, d0], [u1, d1]] = ends;
    out.splice(e, 4, (u0 + u1) / 2, (u1 - u0) / 2, (d0 + d1) / 2, (d1 - d0) / 2);
  }
  return out;
}

// ------------------------------------------------------------ personality
// How a personality shapes motion (config.py PERSONALITY holds the ranges).
// Every slider at its default is the identity: "bubbly" is the M1 feel.

export const PERSONALITY = {
  exaggeration: 1, speed: 1, bounce: 1, fidget_rate: 1, energy_bias: 0, blink_rate: 1,
};

// A personality from a preset name, an object of sliders (over `base`), or
// nothing (then `base`). Unknown names and keys fall back quietly.
export function personalityOf(spec, presets = {}, base = PERSONALITY) {
  const from = typeof spec === "string" ? presets[spec] || {} : spec || {};
  const out = { ...PERSONALITY, ...base };
  for (const k of Object.keys(PERSONALITY)) {
    if (Number.isFinite(Number(from[k])) && from[k] !== null && from[k] !== "") out[k] = Number(from[k]);
  }
  return out;
}

// A spring's damping with more (bounce > 1) or less overshoot.
export function bounced(z, bounce = 1) {
  return bounce === 1 ? z : Math.max(0.15, Math.min(0.97, 1 - (1 - z) * bounce));
}

// An expression pushed further from (k > 1) or pulled toward (k < 1) neutral.
export function exaggerated(pose, neutral, k = 1) {
  return k === 1 ? pose : uncrossed(lerp(neutral, pose, k));
}

// One eye's lids drawn `b` of the way to the line where they meet when shut.
export function shut(lids, b) {
  if (b <= 0) return lids.slice();
  let [hu, su, hl, sl] = lids;
  hu = Math.min(hu, 1);
  hl = Math.max(hl, -1);
  const h = (hu + hl) / 2, s = (su + sl) / 2;
  return [hu + (h - hu) * b, su + (s - su) * b, hl + (h - hl) * b, sl + (s - sl) * b];
}

export function blinked(pose, b) {
  if (b <= 0) return pose;
  return [...shut(pose.slice(0, 4), b), ...shut(pose.slice(4, 8), b), ...pose.slice(8)];
}

// Upper lids lowered toward half-mast by `d`, never raised.
export function droop(lids, d, line = GEOMETRY.droop_line) {
  const [hu, su, hl, sl] = lids;
  const ends = [-1, 1].map((u) => {
    const up = hu + su * u;
    return Math.min(up, up + (line - up) * d);
  });
  return [(ends[0] + ends[1]) / 2, (ends[1] - ends[0]) / 2, hl, sl];
}

// `pose` with animation channels `c` laid over it: {pose, eyes, face}, as
// faceShapes takes them. Every channel is 0 for "the expression as it is".
export function animated(pose, c) {
  const get = (k) => c[k] || 0;
  const out = pose.slice();
  for (const [e, side] of [[0, "shut_l"], [4, "shut_r"]]) {
    let [hu, su, hl, sl] = out.slice(e, e + 4);
    const o = get("open");
    if (o) {
      hu = hu + (1 - hu) * o;
      su = su - su * o;
      hl = hl + (-1 - hl) * o;
      sl = sl - sl * o;
    }
    let lids = [hu, su, hl, sl];
    if (get("droop")) lids = droop(lids, get("droop"));
    out.splice(e, 4, ...shut(lids, get("shut") + get(side)));
  }
  out[8] *= 1 + get("size");
  const dx = get("dx"), dy = get("dy");
  const eyes = [[dx + get("lx"), dy + get("ly")], [dx + get("rx"), dy + get("ry")]];
  return { pose: uncrossed(out), eyes, face: [get("fx"), get("fy")] };
}

// ------------------------------------------------------------ animations

const PROCEDURAL = {
  eye_roll(u) {
    // Over to the left, up and over the top to the right, then home, with
    // the lids at half-mast all the way: the bored kind of roll.
    const r = 0.12;
    const d = 0.6 * ease(u / 0.25) * (1 - ease((u - 1) / 0.5));
    let x, y;
    if (u < 0.25) {
      x = -r * ease(u / 0.25);
      y = 0;
    } else if (u < 0.95) {
      const a = Math.PI * (1 - ease((u - 0.25) / 0.7));
      x = r * Math.cos(a);
      y = r * Math.sin(a);
    } else {
      x = r * (1 - spring((u - 0.95) / 0.55));
      y = 0;
    }
    return { dx: x, dy: y, droop: d };
  },
  glitch(u) {
    // Eight steps of jumps, cut not eased, between the expression and itself.
    const n = Math.floor(u / 0.05);
    if (n < 1 || n >= 9) return {};
    return {
      lx: 0.06 * rand(n, 1), ly: 0.04 * rand(n, 2), rx: 0.06 * rand(n, 3),
      ry: 0.04 * rand(n, 4), size: 0.15 * rand(n, 5), fx: 0.02 * rand(n, 6),
    };
  },
  dizzy(u) {
    // Each eye loops a small circle, the two turning opposite ways.
    const env = ease(u / 0.3) * (1 - ease((u - 1.6) / 0.4));
    const a = (2 * Math.PI * 2 * u) / 1.6;
    const r = 0.07 * env;
    return {
      lx: r * Math.cos(a), ly: r * Math.sin(a),
      rx: -r * Math.cos(a), ry: r * Math.sin(a), droop: 0.3 * env,
    };
  },
};

// An animation definition from alfie-face.json as {length, script(u)}.
export function compileAnimation(def) {
  if (def.procedural) {
    const fn = PROCEDURAL[def.procedural];
    if (!fn) throw new Error(`unknown procedural animation ${def.procedural}`);
    return { length: def.length, script: fn };
  }
  let steps = def.keys.map(([dt, ch, e]) => [dt, ch, EASES[e] || ease]);
  if (Object.keys(steps[steps.length - 1][1]).length) steps = [...steps, [0.45, {}, EASES.spring]];
  const marks = [];
  let t = 0;
  for (const [dt, ch, e] of steps) {
    marks.push([t, t + dt, ch, e]);
    t += dt;
  }
  return {
    length: t,
    script(u) {
      let prev = {};
      for (const [t0, t1, ch, e] of marks) {
        if (u < t1) {
          const f = e((u - t0) / (t1 - t0));
          const out = {};
          for (const k of new Set([...Object.keys(prev), ...Object.keys(ch)])) {
            const a = prev[k] || 0;
            out[k] = a + ((ch[k] || 0) - a) * f;
          }
          return out;
        }
        prev = ch;
      }
      return {};
    },
  };
}

// --------------------------------------------------------------- shapes
// A part's shape (the head, each eye) is data: a spec turned into a closed,
// counter-clockwise outline by `outline`. Every outline has the same n points
// starting at angle 0, so any two shapes with the same n morph by a plain
// lerp, and a circle is exactly the disc xy-bench cut its eyes from. Sharp
// shapes are sampled as a radius per angle; rounded corners are true fillets
// (see `filleted`) sampled along the outline, densest at the corners. Outlines are normalised to fit the box [-1, 1]^2, which keeps
// lids (in eye radii) meaning the same on every shape.
//
//   {type: "circle"}
//   {type: "polygon", sides: 4, roundness: 0..1}   roundness: fillet size, 1 = half an edge
//   {type: "star", points: 5, inner: 0.5, roundness: 0..1}
//   {type: "superellipse", n: 4}            a squircle; n 2 is a circle
//   {type: "path", points: [[x, y], ...], roundness: 0..1}   anything, drawn round the origin
// and on any of them: rotation (degrees), stretch [sx, sy] after fitting.

export const SHAPE_TYPES = ["circle", "polygon", "star", "superellipse", "path"];
const DEG = Math.PI / 180;

// Where the ray from the origin at angle `t` leaves a polygon of `verts`:
// its distance. The farthest crossing wins, so a shape that is not quite
// star-shaped round the origin still gets its outer edge.
function rayRadius(verts, t) {
  const dx = Math.cos(t), dy = Math.sin(t);
  let best = 0;
  for (let i = 0; i < verts.length; i++) {
    const [ax, ay] = verts[i], [bx, by] = verts[(i + 1) % verts.length];
    const ex = bx - ax, ey = by - ay;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const r = (ax * ey - ay * ex) / den;          // along the ray
    const s = (ax * dy - ay * dx) / den;          // along the edge
    if (r > 0 && s >= -1e-9 && s <= 1 + 1e-9 && r > best) best = r;
  }
  return best;
}

function regular(count, radiusAt, start) {
  const out = [];
  for (let k = 0; k < count; k++) {
    const a = start + (2 * Math.PI * k) / count;
    out.push([radiusAt(k) * Math.cos(a), radiusAt(k) * Math.sin(a)]);
  }
  return out;
}

// The shape's radius as a function of angle, before rotation and fitting.
function radial(spec) {
  switch (spec.type || "circle") {
    case "circle":
      return () => 1;
    case "superellipse": {
      const n = Math.max(0.2, Number(spec.n ?? 4));
      return (t) => Math.pow(Math.abs(Math.cos(t)) ** n + Math.abs(Math.sin(t)) ** n, -1 / n);
    }
    case "polygon": {
      const s = Math.max(3, Math.round(spec.sides ?? 4));
      // A point at the top; an even count turns half a side so an edge is on top.
      const verts = regular(s, () => 1, Math.PI / 2 + (s % 2 ? 0 : Math.PI / s));
      return (t) => rayRadius(verts, t);
    }
    case "star": {
      const p = Math.max(2, Math.round(spec.points ?? 5));
      const inner = Math.max(0.05, Math.min(1, Number(spec.inner ?? 0.5)));
      const verts = regular(2 * p, (k) => (k % 2 ? inner : 1), Math.PI / 2);
      return (t) => rayRadius(verts, t);
    }
    case "path": {
      const verts = (spec.points || []).map(([x, y]) => [Number(x), Number(y)]);
      if (verts.length < 3) return () => 1;
      return (t) => rayRadius(verts, t) || 1e-3;
    }
    default:
      throw new Error(`unknown shape type ${spec.type}`);
  }
}

// The corner polygon of a polygon, star or path spec, or null for the types
// that have none (circle, superellipse).
function cornerVerts(spec) {
  switch (spec.type) {
    case "polygon": {
      const s = Math.max(3, Math.round(spec.sides ?? 4));
      return regular(s, () => 1, Math.PI / 2 + (s % 2 ? 0 : Math.PI / s));
    }
    case "star": {
      const p = Math.max(2, Math.round(spec.points ?? 5));
      const inner = Math.max(0.05, Math.min(1, Number(spec.inner ?? 0.5)));
      return regular(2 * p, (k) => (k % 2 ? inner : 1), Math.PI / 2);
    }
    case "path": {
      const v = (spec.points || []).map(([x, y]) => [Number(x), Number(y)]);
      let area = 0;
      v.forEach(([x, y], i) => { const [u, w] = v[(i + 1) % v.length]; area += x * w - u * y; });
      return v.length < 3 ? null : area < 0 ? v.reverse() : v;
    }
    default:
      return null;
  }
}

// `verts` with every corner replaced by a true circular fillet, tangent to
// both edges (like CSS border-radius), as a dense polyline. `k` 0..1 sets
// each fillet's tangent length as that share of half the shorter edge at the
// corner: 1 meets the neighbouring fillets at the edge midpoints (a circle
// for a regular polygon). Inner (reflex) corners of a star fillet the same way.
function filleted(verts, k) {
  const m = verts.length, out = [];
  const STEP = 2 * DEG;                           // arc facet, finer than any eye can show
  for (let i = 0; i < m; i++) {
    const p = verts[(i + m - 1) % m], v = verts[i], q = verts[(i + 1) % m];
    const l1 = Math.hypot(v[0] - p[0], v[1] - p[1]), l2 = Math.hypot(q[0] - v[0], q[1] - v[1]);
    const ux = (v[0] - p[0]) / l1, uy = (v[1] - p[1]) / l1;
    const wx = (q[0] - v[0]) / l2, wy = (q[1] - v[1]) / l2;
    const cross = ux * wy - uy * wx, turn = Math.atan2(cross, ux * wx + uy * wy);
    if (!(l1 > 1e-12 && l2 > 1e-12) || Math.abs(turn) < 1e-6) { out.push(v); continue; }
    const d = (k * Math.min(l1, l2)) / 2, r = d / Math.tan(Math.abs(turn) / 2);
    const side = Math.sign(cross);                // +1: left turn, centre on the left
    const ax = v[0] - ux * d, ay = v[1] - uy * d;
    const cx = ax - side * uy * r, cy = ay + side * ux * r;
    const a0 = Math.atan2(ay - cy, ax - cx);
    const steps = Math.max(2, Math.ceil(Math.abs(turn) / STEP));
    for (let j = 0; j <= steps; j++) {
      const a = a0 + (turn * j) / steps;
      out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return out;
}

// `n` points along a closed polyline `dense`, starting where it crosses the
// ray at angle 0, equally spaced in "length + CORNER_WEIGHT * turning". Plain
// arc length would give a small fillet two or three points; this keeps a
// corner at least ~12 points however tight it is, and stays O(n + m).
const CORNER_WEIGHT = 0.4;
function sampleOutline(dense, n) {
  const m = dense.length;
  const turnAt = (i) => {
    const p = dense[(i + m - 1) % m], v = dense[i], q = dense[(i + 1) % m];
    const a1 = Math.atan2(v[1] - p[1], v[0] - p[0]), a2 = Math.atan2(q[1] - v[1], q[0] - v[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    return Math.abs(d);
  };
  const turns = dense.map((_, i) => turnAt(i));
  const cost = [0];                               // cost[i]: cumulative to dense[i]
  for (let i = 0; i < m; i++) {
    const v = dense[i], q = dense[(i + 1) % m];
    cost.push(cost[i] + Math.hypot(q[0] - v[0], q[1] - v[1]) + CORNER_WEIGHT * (turns[i] + turns[(i + 1) % m]) / 2);
  }
  const total = cost[m];
  // Where the +x ray leaves the polyline (farthest crossing), as a cost.
  let s0 = 0, best = -1;
  for (let i = 0; i < m; i++) {
    const [ax, ay] = dense[i], [bx, by] = dense[(i + 1) % m];
    if ((ay > 0 && by > 0) || (ay < 0 && by < 0) || ay === by) continue;
    const f = ay / (ay - by), x = ax + (bx - ax) * f;
    if (f >= 0 && f <= 1 && x > best) { best = x; s0 = cost[i] + (cost[i + 1] - cost[i]) * f; }
  }
  const pts = [];
  let i = 0;
  for (let k = 0; k < n; k++) {
    let s = s0 + (total * k) / n;
    if (s >= total) s -= total;
    if (k === 0 || s < cost[i]) i = 0;            // wrapped round: rewind once
    while (i < m - 1 && cost[i + 1] <= s) i++;
    const [ax, ay] = dense[i], [bx, by] = dense[(i + 1) % m];
    const span = cost[i + 1] - cost[i], f = span > 0 ? (s - cost[i]) / span : 0;
    pts.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
  }
  return pts;
}

// A shape spec as `n` outline points, counter-clockwise from angle 0.
export function outline(spec, n = GEOMETRY.eye_sides) {
  spec = spec || { type: "circle" };
  const rot = (Number(spec.rotation) || 0) * DEG;
  const k = Math.max(0, Math.min(1, Number(spec.roundness) || 0));
  const verts = k ? cornerVerts(spec) : null;
  let pts = [];
  if (verts) {
    const c = Math.cos(rot), s = Math.sin(rot);
    pts = sampleOutline(filleted(verts, k).map(([x, y]) => [x * c - y * s, x * s + y * c]), n);
  } else {
    const r = radial(spec);
    for (let j = 0; j < n; j++) {
      const t = (2 * Math.PI * j) / n;
      const d = r(t - rot);
      pts.push([d * Math.cos(t), d * Math.sin(t)]);
    }
  }
  if ((spec.type || "circle") !== "circle") {
    const m = Math.max(...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
    if (m > 0) pts = pts.map(([x, y]) => [x / m, y / m]);
  }
  const [sx, sy] = spec.stretch || [1, 1];
  if (sx !== 1 || sy !== 1) pts = pts.map(([x, y]) => [x * sx, y * sy]);
  return pts;
}

// Which points of a closed outline are deliberate corners: the turn there is
// over `limit` degrees. Fillets and circles turn a few degrees a point (a
// 120-point circle 3, a fillet under ~12), while a lid cut or a sharp polygon
// or star tip turns far more, so 25 degrees cleanly separates the two.
// A zero-length edge counts as a corner (nothing to smooth towards).
export function cornerFlags(pts, limit = 25) {
  const m = pts.length, lim = Math.cos(limit * DEG);
  return pts.map((v, i) => {
    const p = pts[(i + m - 1) % m], q = pts[(i + 1) % m];
    const ux = v[0] - p[0], uy = v[1] - p[1], wx = q[0] - v[0], wy = q[1] - v[1];
    const l = Math.hypot(ux, uy) * Math.hypot(wx, wy);
    return !(l > 1e-12) || (ux * wx + uy * wy) / l < lim;
  });
}

// Two outlines of the same length, `f` of the way from a to b.
// `f` may overshoot past 1 (a spring), which overshoots the shape too.
export function blendOutlines(a, b, f) {
  if (f === 0 || a === b) return a;
  if (f === 1) return b;
  if (a.length !== b.length) return f < 0.5 ? a : b;
  return a.map(([x, y], i) => [x + (b[i][0] - x) * f, y + (b[i][1] - y) * f]);
}

// Which shape each part takes: `shapes` is {head, eye, left_eye, right_eye}.
export function partSpecs(shapes = {}) {
  return {
    head: shapes.head || { type: "circle" },
    left: shapes.left_eye || shapes.eye || { type: "circle" },
    right: shapes.right_eye || shapes.eye || { type: "circle" },
  };
}

// `poly` cut by the lid line y = h + s*u (u = nose*x): one
// Sutherland-Hodgman pass. Points on the line are kept, so two lids on the
// same line leave the chord between them, not nothing.
function clip(poly, h, s, nose, keepBelow) {
  const side = (p) => {
    const d = h + s * nose * p[0] - p[1];
    return keepBelow ? d : -d;
  };
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const a = side(p), b = side(q);
    if (a >= -1e-9) out.push(p);
    if ((a > 1e-9 && b < -1e-9) || (a < -1e-9 && b > 1e-9)) {
      const t = a / (a - b);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}

// The eye as a counter-clockwise lap in eye radii from its leftmost point,
// and the index of its rightmost: `base` (an outline, a circle by default)
// cut by the lids.
export function eyeOutline(lids, nose, base = null, sides = GEOMETRY.eye_sides) {
  const [hu, su, hl, sl] = lids;
  let poly = base || outline({ type: "circle" }, sides);
  poly = clip(clip(poly, hu, su, nose, true), hl, sl, nose, false);
  if (poly.length < 2) poly = [[-0.5, 0], [0.5, 0]];
  let k = 0;
  for (let i = 1; i < poly.length; i++) {
    const [x, y] = poly[i], [bx, by] = poly[k];
    if (x < bx || (x === bx && y < by)) k = i;
  }
  const lap = [...poly.slice(k), ...poly.slice(0, k)];
  let right = 0;
  for (let i = 1; i < lap.length; i++) {
    const [x, y] = lap[i], [bx, by] = lap[right];
    if (x > bx || (x === bx && -y > -by)) right = i;
  }
  return { lap, right };
}

// The right eye's shape is the left one seen in a mirror, so a lopsided
// shape (a teardrop, a tilted star) stays symmetric across the face.
export function mirrored(pts) {
  return pts.map(([x, y]) => [-x, y]).reverse();
}

// Unit outlines for each part from `shapes` ({head, eye, left_eye,
// right_eye}): what faceShapes cuts and places.
export function partOutlines(shapes = {}, g = GEOMETRY) {
  const sp = partSpecs(shapes);
  const left = outline(sp.left, g.eye_sides);
  return {
    head: outline(sp.head, g.ring_res),
    left,
    right: shapes.right_eye ? outline(sp.right, g.eye_sides) : mirrored(left),
  };
}

// The face as shapes to draw, in ring radii: the head outline and the two
// eye polygons, each eye moved by `eyes` and everything by `face`. `parts`
// are unit outlines (partOutlines); circles when left out.
export function faceShapes(pose, eyes = [[0, 0], [0, 0]], face = [0, 0], g = GEOMETRY, parts = null) {
  parts = parts || partOutlines({}, g);
  const r = g.eye_r * pose[8];
  const [lx, ly] = [pose[9], pose[10]];
  const [fx, fy] = face;
  const place = (pts, cx, off) => {
    const x0 = cx + lx + off[0] + fx, y0 = ly + off[1] + fy;
    return pts.map(([x, y]) => [x0 + r * x, y0 + r * y]);
  };
  return {
    ring: [fx, fy],
    head: parts.head.map(([x, y]) => [fx + x, fy + y]),
    left: place(eyeOutline(pose.slice(0, 4), 1, parts.left).lap, -g.eye_x, eyes[0]),
    right: place(eyeOutline(pose.slice(4, 8), -1, parts.right).lap, g.eye_x, eyes[1]),
  };
}

// ------------------------------------------------------------ speaking
// He has no mouth, so speaking shows in the ring, the eyes, or both
// (design.md "Voice"). `speechLevel` is a syllable-like rhythm, 0..1, from
// a few incommensurate sines, so it never visibly repeats.

export const SPEAK_STYLES = ["pulse", "eyes", "both", "wave"];

export function speechLevel(t) {
  const s = Math.sin(2 * Math.PI * 4.1 * t) * 0.55 + Math.sin(2 * Math.PI * 6.7 * t + 1.3) * 0.3
    + Math.sin(2 * Math.PI * 1.3 * t + 0.4) * 0.35;
  const phrase = 0.55 + 0.45 * Math.sin(2 * Math.PI * 0.37 * t + 2.1);   // pauses between phrases
  return Math.max(0, Math.min(1, (s * 0.5 + 0.45) * phrase));
}

// Channels added to the face for the eye styles (eyes, both): the eyes grow
// and lift a little on each syllable.
export function speakingChannels(style, strength, t) {
  if (style !== "eyes" && style !== "both") return {};
  const v = speechLevel(t) * strength * (style === "both" ? 0.7 : 1);
  return { size: 0.16 * v, dy: 0.04 * v };
}

// The head outline while speaking (pulse, both, wave): `pts` around `centre`,
// breathed out on each syllable, or rippled like a sound wave.
export function speakingHead(pts, centre, style, strength, t) {
  if (style === "eyes" || !SPEAK_STYLES.includes(style)) return pts;
  const v = speechLevel(t) * strength;
  const [cx, cy] = centre;
  if (style === "wave") {
    return pts.map(([x, y]) => {
      const k = 1 + 0.028 * v * Math.sin(7 * Math.atan2(y - cy, x - cx) + 2 * Math.PI * 1.6 * t);
      return [cx + (x - cx) * k, cy + (y - cy) * k];
    });
  }
  const k = 1 + 0.045 * v * (style === "both" ? 0.7 : 1);
  return pts.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
}
