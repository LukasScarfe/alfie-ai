// Screens: the vector font, the view helpers and icons ported from xy-bench
// (xy/views.py, xy/font.py), and the screen-module registry. Pure ES module,
// no DOM, so node can test it (tests/screens.test.mjs). See
// docs/screens-contract.md.
//
// Everything returns arrays of contract strokes:
//   {pts: [[x, y], ...], closed, w, role: "line" | "text" | "accent" | "dim", fill}
// y runs up, in the face's units (the ring has radius 1). A stroke of one point
// is a dot (the card draws it as a filled dot). Helpers take xy's positional
// arguments, with its keyword arguments as a trailing options object in
// camelCase (`labelH`, `minSpan`, `markerSize`...). Values may be missing or
// malformed; nothing here throws on bad data, it draws something.

const V = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();

// ------------------------------------------------------------------ strokes

export function stroke(pts, { closed = false, w = 1, role = "line", fill = false } = {}) {
  return { pts, closed, w, role, fill };
}

// ------------------------------------------------------------------- values

export function number(v) {
  if (typeof v === "boolean" || v === null || v === undefined) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const f = Number(v);
  return Number.isFinite(f) ? f : null;
}

export function fmt(v, decimals = 0) {
  const f = number(v);
  if (f === null) return "--";
  let s = f.toFixed(decimals);
  if (Number(s) === 0) s = s.replace(/^-/, "");
  return s;
}

// A series as numbers-or-null, averaged down to at most `maxPoints` buckets.
export function series(v, maxPoints = null) {
  if (!Array.isArray(v)) return [];
  let vals = v.map(number);
  if (maxPoints && vals.length > maxPoints) {
    const out = [];
    for (let i = 0; i < maxPoints; i++) {
      const a = Math.floor((i * vals.length) / maxPoints), b = Math.floor(((i + 1) * vals.length) / maxPoints);
      const got = vals.slice(a, b).filter((x) => x !== null);
      out.push(got.length ? got.reduce((s, x) => s + x, 0) / got.length : null);
    }
    vals = out;
  }
  return vals;
}

// [lo, hi] covering every value of the given series (an array of series).
export function span(seriess, { pad = 0, minSpan = 1 } = {}) {
  const vals = seriess.flat().filter((x) => x !== null && x !== undefined);
  if (!vals.length) return [0, 1];
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < minSpan) {
    const mid = (lo + hi) / 2;
    lo = mid - minSpan / 2;
    hi = mid + minSpan / 2;
  }
  const d = (hi - lo) * pad;
  return [lo - d, hi + d];
}

// -------------------------------------------------------------------- font

let FONT = null;
let fontPromise = null;
const GLYPHS = new Map();

// Install the font data (alfie-font.json parsed). Node tests call this directly.
export function setFont(data) {
  FONT = data;
  GLYPHS.clear();
  for (const [ch, g] of Object.entries(data.glyphs)) {
    GLYPHS.set(ch, {
      w: g.w,
      strokes: g.s.map((s) => (s.d ? { dot: s.d } : { closed: !!s.c, pts: pairs(s.p) })),
    });
  }
  return FONT;
}

function pairs(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  return out;
}

// Fetch alfie-font.json next to this file (carrying our ?v=). Resolves once.
export function loadFont() {
  fontPromise ??= fetch(new URL(`./alfie-font.json${V}`, import.meta.url))
    .then((r) => {
      if (!r.ok) throw new Error(`alfie-font.json: HTTP ${r.status}`);
      return r.json();
    })
    .then(setFont);
  return fontPromise;
}

export const fontReady = () => FONT !== null;
export const metrics = () => FONT?.metrics ?? { cap: 1, x_height: 0.62, descender: 0.3, tracking: 0.2, digit_w: 0.56, dot_r: 0.03 };
export const glyphChars = () => [...GLYPHS.keys()];
export const hasGlyph = (ch) => GLYPHS.has(ch);

// A screen's unit: the `unit` option, else the sensor's; "none" shows no unit.
export function unitOf(option, fallback) {
  const u = String(option ?? "").trim();
  if (u.toLowerCase() === "none") return "";
  return (u || String(fallback ?? "")).trim();
}

// `s` as the font can set it: accents dropped (NFKD), curly apostrophes
// straightened, anything the font lacks gone. Spaces are kept.
export function clean(s) {
  if (typeof s !== "string") s = s === null || s === undefined ? "" : String(s);
  s = s.replace(/[’‘]/g, "'").normalize("NFKD");
  let out = "";
  for (const ch of s) if (GLYPHS.has(ch)) out += ch;
  return out;
}

// -------------------------------------------------------------------- icons

// A word of screen text that is an icon name (`mdi:plex`) draws as the icon.
// The card hands over the source: name -> strokes in [-1, 1]² (y up), null
// while it loads (its slot stays empty), false if it never will (then the
// name is set as text). Without a source (node tests) names are text.
let iconSource = null;
let iconCount = 0;
export const ICON_W = 1.3;   // an icon in text, in cap heights, wide and tall
export const isIcon = (word) => /^[a-z][a-z0-9_-]*:[a-z0-9_-]*[a-z][a-z0-9_-]*$/.test(word);
export function setIconSource(fn) { iconSource = fn; iconCount++; }
// The card bumps this when an icon arrives; screens that cache their strokes key on it.
export const iconLoaded = () => { iconCount++; };
export const iconStamp = () => iconCount;
const iconOf = (word) => (iconSource && isIcon(word) ? iconSource(word) ?? null : false);

// `clean` plus runs of space collapsed: xy's `_title`. Icon names stay whole.
export const title = (s) => String(s ?? "").split(/\s+/).map((wd) => (isIcon(wd) ? wd : clean(wd)))
  .join(" ").split(/\s+/).filter(Boolean).join(" ");

// `s` as the pieces it sets: glyphs, and icons ({icon: strokes | null}).
function pieces(s) {
  const out = [];
  for (const part of String(s ?? "").split(/(\s+)/)) {
    const ic = part ? iconOf(part) : false;
    if (ic !== false) { out.push({ icon: ic, w: ICON_W }); continue; }
    for (const ch of clean(part)) out.push({ g: GLYPHS.get(ch), w: GLYPHS.get(ch).w });
  }
  return out;
}

// How wide pieces set, in cap heights, without trailing tracking.
const piecesWidth = (ps) => ps.reduce((t, p) => t + p.w, 0) + metrics().tracking * Math.max(0, ps.length - 1);
const widthCaps = (s) => piecesWidth(pieces(s));

export function width(s, height = 1) {
  return widthCaps(s) * height;
}

// `s` set `height` tall (cap height) and centred on (cx, cy). Dots become
// one-point strokes; an icon is ICON_W tall, centred on the capitals.
// opts: {role = "text", w = 1}.
export function text(s, height, cx = 0, cy = 0, { role = "text", w = 1 } = {}) {
  const ps = pieces(s);
  const ox = cx - (piecesWidth(ps) * height) / 2, oy = cy - height / 2, tr = metrics().tracking;
  const out = [];
  let x = 0;
  for (const p of ps) {
    if (p.icon) {
      const k = (ICON_W * height) / 2, ix = ox + (x + ICON_W / 2) * height;
      for (const st of p.icon) out.push({ ...st, role, w: (st.w ?? 1) * w, pts: st.pts.map(([px, py]) => [ix + px * k, cy + py * k]) });
    }
    for (const st of p.g?.strokes ?? []) {
      if (st.dot) {
        out.push(stroke([[ox + (x + st.dot[0]) * height, oy + st.dot[1] * height]], { role, w }));
      } else {
        out.push(stroke(st.pts.map(([px, py]) => [ox + (x + px) * height, oy + py * height]),
          { closed: st.closed, role, w }));
      }
    }
    x += p.w + tr;
  }
  return out;
}

// Words greedily into lines no wider than `room` cap heights.
export function wrap(s, room) {
  const lines = [];
  for (const word of title(s).split(" ").filter(Boolean)) {
    if (lines.length && widthCaps(`${lines[lines.length - 1]} ${word}`) <= room) lines[lines.length - 1] += ` ${word}`;
    else lines.push(word);
  }
  return lines;
}

// ----------------------------------------------------------------- readouts

export function readout(value, height, cx = 0, cy = 0, { unit = "", decimals = 0, role = "text" } = {}) {
  return text(fmt(value, decimals) + unit, height, cx, cy, { role });
}

export function readoutWidth(value, height, { unit = "", decimals = 0 } = {}) {
  return width(fmt(value, decimals) + unit, height);
}

// ------------------------------------------------------------------- charts

export const DOTTED = 0.15;   // weight of a dotted series: the card draws w < 0.3 dashed and dim

function place(vals, x0, y0, w, h, lo, hi) {
  const n = vals.length, k = hi > lo ? h / (hi - lo) : 0, out = [];
  vals.forEach((v, i) => {
    if (v === null || v === undefined) return;
    out.push([x0 + (n > 1 ? (w * i) / (n - 1) : w / 2), y0 + (Math.min(Math.max(v, lo), hi) - lo) * k]);
  });
  return out;
}

// `steps`: each value runs flat to the next point, then the line jumps.
export function curve(values, x0, y0, w, h, { lo = null, hi = null, marks = [], weight = 1, tick = null, role = "line", steps = false } = {}) {
  const vals = [...values];
  if (lo === null || hi === null) [lo, hi] = span([vals]);
  let pts = place(vals, x0, y0, w, h, lo, hi);
  if (!pts.length) return [];
  tick = tick === null ? h * 0.12 : tick;
  const pos = new Map();
  let j = 0;
  vals.forEach((v, i) => { if (v !== null && v !== undefined) pos.set(i, j++); });
  const at = [...new Set(marks.filter((m) => pos.has(m)).map((m) => pos.get(m)))].sort((a, b) => b - a);
  for (const i of at) {
    const [x, y] = pts[i], d = y < y0 + h / 2 ? tick : -tick;
    pts = [...pts.slice(0, i + 1), [x, y + d], [x, y], ...pts.slice(i + 1)];
  }
  if (steps) pts = pts.flatMap((p, i) => (i && pts[i - 1][0] !== p[0] ? [[p[0], pts[i - 1][1]], p] : [p]));
  return [stroke(pts, { w: weight, role })];
}

export function baseline(x0, y0, w, { ticks = 0, tick = 0.03, weight = 0.5 } = {}) {
  const pts = [[x0, y0]];
  for (let k = 1; k < ticks; k++) {
    const x = x0 + (w * k) / ticks;
    pts.push([x, y0], [x, y0 - tick], [x, y0]);
  }
  pts.push([x0 + w, y0]);
  return [stroke(pts, { w: weight })];
}

// Round values to label an axis spanning lo..hi: the finest of 1, 2, 5, 10,
// 20, 25, 50, 100 giving at most `most` ticks.
export function niceTicks(lo, hi, most = 4) {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100]) {
    const ticks = [];
    for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(v);
    if (ticks.length <= most) return ticks;
  }
  return [lo, hi];
}

export function axis(x, y0, h, lo, hi, ticks, { unit = "", labelH = 0.075, tick = 0.03, weight = 0.5, unlabelled = [], side = "left" } = {}) {
  const k = hi !== lo ? h / (hi - lo) : 0;
  const pts = [[x, y0]], labels = [];
  ticks = [...ticks].sort((a, b) => a - b);
  const out = side === "left" ? -1 : 1;
  for (const v of [...ticks].sort((a, b) => (a - lo) * k - (b - lo) * k)) {
    const y = y0 + (v - lo) * k;
    pts.push([x, y], [x + out * tick, y], [x, y]);
    if (unlabelled.includes(v)) continue;
    const t = fmt(v) + (v === ticks[ticks.length - 1] ? unit : "");
    labels.push(...text(t, labelH, x + out * (tick + 0.03 + width(t, labelH) / 2), y));
  }
  pts.push([x, y0 + h]);
  return [stroke(pts, { w: weight }), ...labels];
}

// The built-in marker shapes; any other icon name (mdi:account) draws that
// icon, MARKER_ICON times the size, outlined; a ring while it loads or if it never does.
export const MARKER_SHAPES = ["ring", "diamond", "square", "triangle", "star", "cross", "x", "dot", "house", "sun"];
export const MARKER_ICON = 2.6;
const around = (cx, cy, r, n, a0 = 0, rs = null) => Array.from({ length: n }, (_, i) => {
  const a = a0 + (2 * Math.PI * i) / n, q = rs ? rs[i % rs.length] : r;
  return [cx + q * Math.cos(a), cy + q * Math.sin(a)];
});
export function marker(kind, cx, cy, size, { role = "line" } = {}) {
  const r = size / 2;
  const ic = isIcon(kind) && iconSource ? iconSource(kind, { fill: "none" }) : null;
  if (ic) {
    const k = (MARKER_ICON * size) / 2;
    return ic.map((st) => ({ ...st, role, pts: st.pts.map(([px, py]) => [cx + px * k, cy + py * k]) }));
  }
  if (kind === "house") return house(cx, cy + size / 2, size);
  if (kind === "sun") return [sunIcon(cx, cy, r * 0.6, 8, 0.8)];
  if (kind === "cross" || kind === "x") {
    const d = kind === "x" ? r * 0.85 : r * 1.1;
    return kind === "x"
      ? [stroke([[cx - d, cy - d], [cx + d, cy + d]], { role }), stroke([[cx - d, cy + d], [cx + d, cy - d]], { role })]
      : [stroke([[cx - d, cy], [cx + d, cy]], { role }), stroke([[cx, cy - d], [cx, cy + d]], { role })];
  }
  let pts;
  if (kind === "square") pts = [[cx - r, cy - r], [cx + r, cy - r], [cx + r, cy + r], [cx - r, cy + r]];
  else if (kind === "diamond") pts = [[cx, cy - r], [cx + r, cy], [cx, cy + r], [cx - r, cy]];
  else if (kind === "triangle") pts = around(cx, cy - r * 0.15, r * 1.15, 3, Math.PI / 2);
  else if (kind === "star") pts = around(cx, cy, r, 10, Math.PI / 2, [r * 1.25, r * 0.5]);
  else pts = around(cx, cy, kind === "dot" ? r * 0.4 : r, kind === "dot" ? 12 : 24);
  return [stroke(pts, { closed: true, role })];
}

export function bars(values, x0, y0, w, h, { lo = 0, hi = 100, fill = 0.6, weight = 1 } = {}) {
  const vals = [...values], n = vals.length, slot = n ? w / n : w, bw = slot * fill;
  const k = hi > lo ? h / (hi - lo) : 0;
  const pts = [[x0, y0]];
  vals.forEach((v, i) => {
    const bh = v === null || v === undefined ? 0 : (Math.min(Math.max(v, lo), hi) - lo) * k;
    if (Math.abs(bh) > 1e-6) {
      const x = x0 + slot * i + (slot - bw) / 2;
      pts.push([x, y0], [x, y0 + bh], [x + bw, y0 + bh], [x + bw, y0]);
    }
  });
  pts.push([x0 + w, y0]);
  return [stroke(pts, { w: weight })];
}

// -------------------------------------------------------------------- icons

export function house(cx, cy, size, smoke = null) {
  const w = size * 0.8, wall = size * 0.55, x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - size / 2;
  const apex = [cx, y0 + size], eave = [x1, y0 + wall];
  let wisp = [];
  if (smoke !== null) {
    const bx = apex[0] + (eave[0] - apex[0]) * 0.55, by = apex[1] + (eave[1] - apex[1]) * 0.55, n = 10;
    wisp = Array.from({ length: n + 1 }, (_, k) => [
      bx + 0.12 * size * (k / n) * Math.sin(2 * Math.PI * ((1.1 * k) / n - smoke)), by + (0.5 * size * k) / n]);
    wisp = [[bx, by], ...wisp.slice(1), ...wisp.slice(1, -1).reverse(), [bx, by]];
  }
  return [stroke([[x0, y0], [x0, y0 + wall], apex, ...wisp, eave, [x1, y0]])];
}

export function leaf(cx, cy, size) {
  const h = size * 0.78, w = size * 0.5, base = size * 0.22, a = (-30 * Math.PI) / 180;
  const rot = (x, y) => {
    y -= size / 2;
    return [cx + x * Math.cos(a) - y * Math.sin(a), cy + x * Math.sin(a) + y * Math.cos(a)];
  };
  const edge = (sign, up) => {
    const out = [];
    for (let t = up ? 1 : 15; up ? t < 16 : t > 0; t += up ? 1 : -1) {
      out.push([sign * (w / 2) * Math.sin(Math.PI * (t / 16) ** 0.8), base + (h * t) / 16]);
    }
    return out;
  };
  const pts = [[0, 0], [0, base], ...edge(-1, true), [0, base + h], ...edge(1, false), [0, base]];
  return [stroke(pts.map(([x, y]) => rot(x, y)), { closed: true })];
}

export function drop(cx, cy, size) {
  const r = size * 0.32, by = cy - size / 2 + r, tip = [cx, cy + size / 2];
  const a = Math.acos(r / (tip[1] - by)), pts = [tip];
  for (let i = 0; i < 25; i++) {
    const t = Math.PI / 2 + a + ((2 * Math.PI - 2 * a) * i) / 24;
    pts.push([cx + r * Math.cos(t), by + r * Math.sin(t)]);
  }
  return [stroke(pts, { closed: true })];
}

const CLOUD_CIRCLES = [[0.2, 0.2, 0.2], [0.4, 0.42, 0.21], [0.64, 0.48, 0.24], [0.8, 0.2, 0.2]];
const CLOUD_SLAB = [0.2, 0.0, 0.8, 0.2];
const CLOUD_EYE = [0.5, 0.25];

function inCloud(x, y) {
  const [bx0, by0, bx1, by1] = CLOUD_SLAB;
  if (bx0 <= x && x <= bx1 && by0 <= y && y <= by1) return true;
  return CLOUD_CIRCLES.some(([cx, cy, r]) => Math.hypot(x - cx, y - cy) <= r);
}

function cloudReach(theta) {
  const [ex, ey] = CLOUD_EYE, dx = Math.cos(theta), dy = Math.sin(theta);
  let lo = 0, hi = 1;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (inCloud(ex + dx * mid, ey + dy * mid) || inCloud(ex + dx * (mid + (hi - mid) * 0.5), ey + dy * (mid + (hi - mid) * 0.5))) lo = mid;
    else hi = mid;
  }
  return lo;
}

let cloudTopCache = null;
function cloudTop() {
  if (cloudTopCache) return cloudTopCache;
  const [ex, ey] = CLOUD_EYE, a0 = Math.atan2(0 - ey, 0.8 - ex), a1 = Math.atan2(0 - ey, 0.2 - ex) + 2 * Math.PI, n = 48;
  cloudTopCache = Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n, r = cloudReach(a);
    return [ex + r * Math.cos(a), ey + r * Math.sin(a)];
  });
  return cloudTopCache;
}

// A cloud `w` wide centred on (cx, cy); `hang` is [[fx, [[dx, dy]...]]]: rain,
// snow or a bolt traced out and back from the flat base.
function cloudStroke(cx, cy, w, hang = []) {
  const h = w * 0.72, x0 = cx - w / 2, y0 = cy - h / 2, pts = [[x0 + w * 0.2, y0]];
  for (const [fx, spike] of [...hang].sort((a, b) => a[0] - b[0])) {
    const bx = x0 + w * (0.2 + 0.6 * fx), out = spike.map(([dx, dy]) => [bx + dx * w, y0 + dy * w]);
    pts.push([bx, y0], ...out, ...out.slice(0, -1).reverse(), [bx, y0]);
  }
  pts.push(...cloudTop().map(([ux, uy]) => [x0 + w * ux, y0 + w * uy]));
  return stroke(pts, { closed: true });
}

export const cloud = (cx, cy, w, hang = []) => [cloudStroke(cx, cy, w, hang)];

function sunIcon(cx, cy, r, rays = 8, ray = 0.7) {
  const pts = [], n = 40;
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n, p = [cx + r * Math.sin(a), cy + r * Math.cos(a)];
    pts.push(p);
    if (i % (n / rays) === 0) pts.push([cx + r * (1 + ray) * Math.sin(a), cy + r * (1 + ray) * Math.cos(a)], p);
  }
  return stroke(pts, { closed: true });
}

export const sun = (cx, cy, r, rays = 8, ray = 0.7) => [sunIcon(cx, cy, r, rays, ray)];

// Icon for a Home Assistant weather condition, about `size` wide, centred on
// (cx, cy). At `night` the sun becomes a crescent. Unknown: nothing.
export function weatherIcon(condition, cx, cy, size, night = false) {
  let c = typeof condition === "string" ? condition : "";
  if (night && c === "sunny") c = "clear-night";
  const rain = [[0.15, 0.8], [0.5, 1.0], [0.85, 0.65]].map(([f, k]) => [f, [[-0.06 * k, -0.16 * k]]]);
  const pour = [[0.05, 0.55], [0.3, 0.8], [0.55, 0.6], [0.8, 0.85], [1.0, 0.5]].map(([f, k]) => [f, [[-0.08 * k, -0.24 * k]]]);
  const snow = [0.15, 0.5, 0.85].map((f) => [f, [[0.03 * Math.sin(2 * Math.PI * f), -0.1], [0.03 * Math.sin(2 * Math.PI * f + 1.0), -0.16]]]);
  const bolt = [[0.5, [[-0.08, -0.12], [0.04, -0.12], [-0.04, -0.28]]]];
  const cloudY = cy + size * 0.12;
  if (c === "sunny") return [sunIcon(cx, cy, size * 0.22)];
  if (c === "clear-night") {
    const r = size * 0.3, n = 24;
    const limb = Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.sin((Math.PI * i) / n + Math.PI), cy + r * Math.cos((Math.PI * i) / n + Math.PI)]);
    const term = [];
    for (let i = n - 1; i > 0; i--) term.push([cx - 0.45 * r * Math.sin((Math.PI * i) / n), cy - r * Math.cos((Math.PI * i) / n)]);
    return [stroke([...limb, ...term], { closed: true })];
  }
  if (c === "partlycloudy") {
    const cw = size * 0.8, ccx = cx + size * 0.08, ccy = cy - size * 0.06;
    const sx = cx - size * 0.16, sy = cy + size * 0.2, sr = size * 0.15;
    const ox = ccx - cw / 2, oy = ccy - cw * 0.36;
    const hidden = (p) => inCloud((p[0] - ox) / cw, (p[1] - oy) / cw);
    let pts = [];
    const n = 64;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * i) / n, p = [sx + sr * Math.sin(a), sy + sr * Math.cos(a)];
      if (night) {
        const t = (Math.PI * i) / (n - 1), outer = [sx - sr * Math.sin(t), sy + sr * Math.cos(t)];
        if (!hidden(outer)) pts.push(outer);
        continue;
      }
      if (hidden(p)) continue;
      pts.push(p);
      const q = [sx + 1.7 * sr * Math.sin(a), sy + 1.7 * sr * Math.cos(a)];
      if (i % 8 === 0 && !hidden(q)) pts.push(q, p);
    }
    if (night) {
      for (let i = 31; i >= 0; i--) {
        const p = [sx - 0.45 * sr * Math.sin((Math.PI * i) / 31), sy + sr * Math.cos((Math.PI * i) / 31)];
        if (!hidden(p)) pts.push(p);
      }
      return [stroke(pts), cloudStroke(ccx, ccy, cw)];
    }
    let k = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) > sr) { k = i; break; }
    }
    pts = [...pts.slice(k), ...pts.slice(0, k)];
    return [stroke(pts), cloudStroke(ccx, ccy, cw)];
  }
  if (c === "cloudy" || c === "exceptional") return [cloudStroke(cx, cy, size)];
  if (c === "rainy") return [cloudStroke(cx, cloudY, size, rain)];
  if (c === "pouring") return [cloudStroke(cx, cloudY, size, pour)];
  if (c === "snowy" || c === "snowy-rainy" || c === "hail") return [cloudStroke(cx, cloudY, size, snow)];
  if (c === "lightning" || c === "lightning-rainy") return [cloudStroke(cx, cloudY, size, bolt)];
  if (c === "fog") {
    const pts = [];
    [[0.15, 0.03], [0.0, -0.03], [-0.15, 0.02]].forEach(([y, dx], i) => {
      const row = [[cx - size / 2 + dx * size, cy + y * size], [cx + size / 2 + dx * size, cy + y * size]];
      pts.push(...(i % 2 === 0 ? row : row.reverse()));
    });
    return [stroke(pts)];
  }
  if (c === "windy" || c === "windy-variant") {
    const pts = [];
    [0.12, -0.05].forEach((y, i) => {
      const row = Array.from({ length: 17 }, (_, k) => [cx - size / 2 + (size * k) / 16, cy + y * size + 0.04 * size * Math.sin((Math.PI * k) / 4)]);
      pts.push(...(i % 2 === 0 ? row : row.reverse()));
    });
    return [stroke(pts)];
  }
  return [];
}

export function car(cx, cy, size) {
  const L = size, r = L * 0.12, x0 = cx - L / 2, y0 = cy - L * 0.18;
  const wheel = (wx) => Array.from({ length: 21 }, (_, i) => [wx + r * Math.sin((2 * Math.PI * i) / 20), y0 + r * Math.cos((2 * Math.PI * i) / 20)]);
  const pts = [[x0, y0 + r], ...wheel(x0 + L * 0.22), ...wheel(x0 + L * 0.78),
    [x0 + L, y0 + r], [x0 + L, y0 + L * 0.2], [x0 + L * 0.72, y0 + L * 0.24], [x0 + L * 0.58, y0 + L * 0.4],
    [x0 + L * 0.3, y0 + L * 0.4], [x0 + L * 0.18, y0 + L * 0.24], [x0, y0 + L * 0.22]];
  return [stroke(pts, { closed: true })];
}

// ----------------------------------------------------------------- registry

const modules = new Map();

// The drawing module for a screen type: `./screens/<type>.js`, imported once,
// carrying the card's ?v=. Rejects if the type has no module or it fails to load.
export function loadScreen(type) {
  if (!/^[a-z0-9_]+$/.test(String(type))) return Promise.reject(new Error(`bad screen type: ${type}`));
  if (!modules.has(type)) {
    const p = import(`./screens/${type}.js${V}`).then((m) => m.default);
    p.catch(() => modules.delete(type));
    modules.set(type, p);
  }
  return modules.get(type);
}
