// An uploaded SVG as Alfie strokes (design.md "Screens": Picture). Pure, so
// node tests run it; no DOMParser, because the engine has already sanitised
// the file (pictures.py) down to svg, g, a, switch and the basic shapes, with
// their transforms and paint in a style attribute.
//
//   parseXml(text)               -> {name, attrs, children} (the root element)
//   parseTransform(s)            -> [a, b, c, d, e, f]
//   pictureContours(text, detail) -> {contours: [{pts, closed, filled, color}], bounds}
//                                   in the SVG's units, y down
//   fitContours(pic, box, opts)  -> contract strokes in the box, y up
//
// A filled shape is drawn as its outlines, closed (as icons are); a shape that
// is only stroked is drawn as the line itself. Curves flatten through
// alfie-icons.js `flatten`, at a step set by the picture's size and `detail`.

const V = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const { flatten } = await import(`./alfie-icons.js${V}`);

// ------------------------------------------------------------------ XML

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescape = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
  e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    : ENTITIES[e] ?? m);

export function parseXml(text) {
  const s = String(text || "");
  const root = { name: "#root", attrs: {}, children: [] };
  const stack = [root];
  const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/\s*([\w:.-]+)\s*>|<([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
  const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = TAG.exec(s))) {
    if (m[1]) {
      // A close tag: pop to the matching open one (a stray close is ignored).
      const at = stack.map((e) => e.name).lastIndexOf(m[1].replace(/^.*:/, ""));
      if (at > 0) stack.length = at;
    } else if (m[2]) {
      const attrs = {};
      for (const a of m[3].matchAll(ATTR)) attrs[a[1]] = unescape(a[2] ?? a[3]);
      const el = { name: m[2].replace(/^.*:/, ""), attrs, children: [] };
      stack[stack.length - 1].children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root.children.find((c) => c.name === "svg") || null;
}

// ------------------------------------------------------------ transforms

const I = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

export function parseTransform(s) {
  let out = I;
  for (const [, fn, args] of String(s || "").matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = (args.match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) || []).map(Number);
    const rad = (deg) => (deg * Math.PI) / 180;
    let m = null;
    switch (fn) {
      case "matrix": if (a.length === 6) m = a; break;
      case "translate": m = [1, 0, 0, 1, a[0] || 0, a[1] || 0]; break;
      case "scale": m = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0]; break;
      case "rotate": {
        const c = Math.cos(rad(a[0] || 0)), sn = Math.sin(rad(a[0] || 0));
        m = [c, sn, -sn, c, 0, 0];
        if (a.length === 3) m = mul(mul([1, 0, 0, 1, a[1], a[2]], m), [1, 0, 0, 1, -a[1], -a[2]]);
        break;
      }
      case "skewX": m = [1, 0, Math.tan(rad(a[0] || 0)), 1, 0, 0]; break;
      case "skewY": m = [1, Math.tan(rad(a[0] || 0)), 0, 1, 0, 0]; break;
    }
    if (m) out = mul(out, m);
  }
  return out;
}

// ---------------------------------------------------------------- shapes

const num = (v, d = 0) => { const x = parseFloat(v); return Number.isFinite(x) ? x : d; };

function ellipseD(cx, cy, rx, ry) {
  return `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`;
}

// A basic shape as path data, in its own units.
export function shapeD(el) {
  const a = el.attrs;
  switch (el.name) {
    case "path": return a.d || "";
    case "rect": {
      const x = num(a.x), y = num(a.y), w = num(a.width), h = num(a.height);
      if (w <= 0 || h <= 0) return "";
      let rx = a.rx !== undefined ? num(a.rx) : a.ry !== undefined ? num(a.ry) : 0;
      let ry = a.ry !== undefined ? num(a.ry) : rx;
      rx = Math.min(Math.max(rx, 0), w / 2); ry = Math.min(Math.max(ry, 0), h / 2);
      if (!rx || !ry) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
      return `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}V${y + h - ry}`
        + `A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}`
        + `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`;
    }
    case "circle": { const r = num(a.r); return r > 0 ? ellipseD(num(a.cx), num(a.cy), r, r) : ""; }
    case "ellipse": {
      const rx = num(a.rx), ry = num(a.ry);
      return rx > 0 && ry > 0 ? ellipseD(num(a.cx), num(a.cy), rx, ry) : "";
    }
    case "line": return `M${num(a.x1)} ${num(a.y1)}L${num(a.x2)} ${num(a.y2)}`;
    case "polyline": case "polygon": {
      const p = (a.points || "").trim();
      return p ? `M${p}${el.name === "polygon" ? "Z" : ""}` : "";
    }
  }
  return "";
}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const GROUPS = new Set(["svg", "g", "a", "switch"]);

function paintOf(el, inherited) {
  const p = { ...inherited };
  for (const k of ["fill", "stroke", "display", "visibility", "opacity"]) if (el.attrs[k] !== undefined) p[k] = el.attrs[k].trim();
  for (const part of String(el.attrs.style || "").split(";")) {
    const i = part.indexOf(":");
    if (i > 0) p[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
  }
  return p;
}

const colourOf = (v) => (!v || v === "none" || /^currentcolor$/i.test(v) || /url\(/i.test(v) ? null : v);

// The size of the picture's own box: its viewBox, else width and height.
export function viewSize(svg) {
  const vb = String(svg?.attrs.viewBox || "").trim().split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return vb;
  const w = num(svg?.attrs.width, 0), h = num(svg?.attrs.height, 0);
  return w > 0 && h > 0 ? [0, 0, w, h] : null;
}

export function pictureContours(text, detail = 1) {
  const svg = typeof text === "string" ? parseXml(text) : text;
  const contours = [];
  if (!svg) return { contours, bounds: null };
  const vb = viewSize(svg);
  // About 240 steps across the picture at detail 1.
  const step = (vb ? Math.max(vb[2], vb[3]) : 100) / 240 / Math.max(0.1, detail);
  let shape = 0;
  const walk = (el, m, inherited, top) => {
    const p = paintOf(el, inherited);
    if (p.display === "none" || num(p.opacity, 1) <= 0) return;
    const mm = el.attrs.transform ? mul(m, parseTransform(el.attrs.transform)) : m;
    if (GROUPS.has(el.name)) {
      // A nested <svg> sits at its x, y.
      const at = el.name === "svg" && !top ? mul(mm, [1, 0, 0, 1, num(el.attrs.x), num(el.attrs.y)]) : mm;
      for (const c of el.children) walk(c, at, p, false);
      return;
    }
    if (!SHAPES.has(el.name) || p.visibility === "hidden") return;
    const fill = p.fill ?? "black", stroke = p.stroke ?? "none";
    const filled = fill !== "none" && num(p["fill-opacity"], 1) > 0;
    const stroked = stroke !== "none";
    if (!filled && !stroked) return;
    const scale = Math.sqrt(Math.abs(mm[0] * mm[3] - mm[1] * mm[2])) || 1;
    const filledShape = filled && el.name !== "line";
    const color = colourOf(filled ? fill : stroke);
    shape += 1;
    for (const c of flatten(shapeD(el), step / scale)) {
      contours.push({
        pts: c.pts.map((pt) => apply(mm, pt)),
        // SVG fill closes every subpath; a stroke-only line stays as drawn.
        closed: filledShape ? true : c.closed,
        filled: filledShape,
        color,
        shape,
        rule: p["fill-rule"] === "evenodd" ? "evenodd" : undefined,
      });
    }
  };
  walk(svg, I, {}, true);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of contours) for (const [x, y] of c.pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { contours, bounds: contours.length ? [x0, y0, x1, y1] : null };
}

// --------------------------------------------------------------- fitting

function size(c) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of c.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return Math.hypot(x1 - x0, y1 - y0);
}

// Every n-th point (keeping the last of an open line), so a contour costs less.
function thin(pts, k, closed) {
  if (k <= 1 || pts.length <= 4) return pts;
  const out = pts.filter((_, i) => i % k === 0);
  if (!closed && out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out.length >= (closed ? 3 : 2) ? out : pts;
}

// The contours as strokes in the box [-w, w] x [-h, h], y up, centred.
// opts: {fit: "contain" | "stretch", scale, rotation (deg), role, own (use the
// SVG's colours), fill: "none" | "soft" | "solid", weight, budget (points)}.
export function fitContours(pic, w, h, opts = {}) {
  if (!pic?.bounds) return [];
  const [x0, y0, x1, y1] = pic.bounds;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const pw = Math.max(1e-9, x1 - x0), ph = Math.max(1e-9, y1 - y0);
  const s = Number(opts.scale) || 1;
  const rot = ((Number(opts.rotation) || 0) * Math.PI) / 180;
  // The rotated picture's extent, so a turned picture still fits.
  const c = Math.abs(Math.cos(rot)), sn = Math.abs(Math.sin(rot));
  const ew = pw * c + ph * sn, eh = pw * sn + ph * c;
  let kx, ky;
  if (opts.fit === "stretch") { kx = (2 * w) / ew; ky = (2 * h) / eh; }
  else kx = ky = Math.min((2 * w) / ew, (2 * h) / eh);
  kx *= s; ky *= s;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  // Over budget: drop the tiniest contours, then thin what is left.
  let list = pic.contours;
  const budget = Math.max(100, Number(opts.budget) || 3000);
  let total = list.reduce((n, k) => n + k.pts.length, 0);
  if (total > budget) {
    const sized = list.map((k) => [size(k), k]).sort((a, b) => b[0] - a[0]);
    const floor = Math.hypot(pw, ph) * 0.004;
    list = []; total = 0;
    for (const [d, k] of sized) {
      if (d < floor && total > budget * 0.5) continue;
      list.push(k); total += k.pts.length;
    }
  }
  const every = Math.max(1, Math.ceil(total / budget));
  const solid = { none: 0, soft: 0.3, solid: 1 }[opts.fill] || 0;
  // One fill group per shape, so a path's holes stay holes and each keeps its colour.
  const groups = new Map();
  const role = opts.role || "line", wt = Number(opts.weight) || 1;
  return list.map((k) => {
    const pts = thin(k.pts, every, k.closed).map(([x, y]) => {
      const dx = x - cx, dy = -(y - cy);
      return [(dx * cr - dy * sr) * kx, (dx * sr + dy * cr) * ky];
    });
    const st = { pts, closed: k.closed, w: wt, role, fill: false };
    if (opts.own && k.color) st.color = k.color;
    if (solid && k.filled) {
      if (!groups.has(k.shape)) groups.set(k.shape, {});
      st.group = groups.get(k.shape); st.solid = solid;
      if (k.rule) st.rule = k.rule;
    }
    return st;
  });
}

// ------------------------------------------------------- shape outlines

// Ramer-Douglas-Peucker on a closed ring: the corners that matter within `tol`.
function simplify(pts, tol) {
  if (pts.length <= 3) return pts;
  // Split the ring at its two farthest-apart points (a rough pair is enough).
  let a = 0, b = 0, far = -1;
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]);
    if (d > far) { far = d; b = i; }
  }
  const keep = new Uint8Array(pts.length);
  keep[a] = keep[b] = 1;
  const stack = [[a, b], [b, pts.length]];
  const at = (i) => pts[i % pts.length];
  while (stack.length) {
    const [i, j] = stack.pop();
    if (j - i < 2) continue;
    const [ax, ay] = at(i), [bx, by] = at(j);
    const L = Math.hypot(bx - ax, by - ay) || 1e-12;
    let best = -1, k = -1;
    for (let m = i + 1; m < j; m++) {
      const [px, py] = at(m);
      const d = L > 1e-12 ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / L : Math.hypot(px - ax, py - ay);
      if (d > best) { best = d; k = m; }
    }
    if (best > tol) { keep[k % pts.length] = 1; stack.push([i, k], [k, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

const ringArea = (v) => v.reduce((s, [x, y], i) => { const [u, w] = v[(i + 1) % v.length]; return s + x * w - u * y; }, 0) / 2;

// The biggest closed outline of `contours` (from pictureContours, or icon
// `flatten`, both y down) as at most `max` path points for a face shape:
// centred, y up, counter-clockwise, fitted to [-1, 1]. Null if there is none.
export function outlinePoints(contours, max = 64) {
  let best = null, area = 0;
  for (const c of contours || []) {
    if (c.pts.length < 3) continue;
    const a = Math.abs(ringArea(c.pts));
    if (a > area) { area = a; best = c.pts; }
  }
  if (!best || area <= 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of best) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, h = Math.max(x1 - x0, y1 - y0) / 2 || 1;
  let pts = best.map(([x, y]) => [(x - cx) / h, -(y - cy) / h]);
  if (ringArea(pts) < 0) pts.reverse();
  // The loosest tolerance that keeps within `max`, by halving.
  let lo = 0, hi = 0.5, out = simplify(pts, hi);
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2, s = simplify(pts, mid);
    if (s.length <= max) { out = s; hi = mid; } else lo = mid;
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  return out.length >= 3 ? out.map(([x, y]) => [r(x), r(y)]) : null;
}
