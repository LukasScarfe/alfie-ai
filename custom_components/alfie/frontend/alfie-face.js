// Alfie's face maths: pure functions, no DOM, so node can test them against
// xy-bench's own numbers (tests/golden_face.json). Ported from xy-bench
// figures.py; the names follow it so the two can be read side by side.
//
// Units are ring radii, y up. A pose is a flat array, so a blend is a lerp:
//   [hu, su, hl, sl] left eye lids, the same for the right, size, look x, y.
// Lids are straight lines y = h + s*u in eye radii, u pointing to the nose.

export const GEOMETRY = {
  eye_x: 0.42, eye_r: 0.25, eye_sides: 64, ring_res: 96, blend: 0.8,
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
// and the index of its rightmost.
export function eyeOutline(lids, nose, sides = GEOMETRY.eye_sides) {
  const [hu, su, hl, sl] = lids;
  let poly = [];
  for (let k = 0; k < sides; k++) {
    const a = (2 * Math.PI * k) / sides;
    poly.push([Math.cos(a), Math.sin(a)]);
  }
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

// The face as shapes to draw, in ring radii: the ring's centre and the two
// eye polygons, each eye moved by `eyes` and everything by `face`.
export function faceShapes(pose, eyes = [[0, 0], [0, 0]], face = [0, 0], g = GEOMETRY) {
  const r = g.eye_r * pose[8];
  const [lx, ly] = [pose[9], pose[10]];
  const [fx, fy] = face;
  const place = (pts, cx, off) => {
    const x0 = cx + lx + off[0] + fx, y0 = ly + off[1] + fy;
    return pts.map(([x, y]) => [x0 + r * x, y0 + r * y]);
  };
  return {
    ring: [fx, fy],
    left: place(eyeOutline(pose.slice(0, 4), 1, g.eye_sides).lap, -g.eye_x, eyes[0]),
    right: place(eyeOutline(pose.slice(4, 8), -1, g.eye_sides).lap, g.eye_x, eyes[1]),
  };
}
