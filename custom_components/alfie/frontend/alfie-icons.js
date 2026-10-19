// Home Assistant icons (mdi:*, and any custom iconset) as Alfie strokes
// (design.md "Icons"). HA's own <ha-icon> resolves a name to its SVG path, so
// every icon HA can show works, from HA's cache, with no network of ours.
//
//   iconPath(name)                -> Promise<{path, viewBox}> (memoised; null if unknown)
//   pathStrokes(d, viewBox, opts) -> contract strokes in the box [-1, 1]², y up
//   strokesFor(name, opts)        -> those strokes now, or null while the path loads
//                                    (it starts loading; `failed(name)` says it never will)
//
// An icon is a filled shape in SVG; Alfie draws its outlines, which is his
// line style. Curves are flattened evenly (about `step` box units a point), so
// the morph moves points evenly too. Everything but iconPath is pure (node tests).

const VIEWBOX = [0, 0, 24, 24];   // mdi's, and HA's default

// ------------------------------------------------------------------ parsing

const TOKEN = /([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)/g;
const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

// [[cmd, [numbers...]], ...], each command repeated per argument group, so
// "L1 2 3 4" is two L's. Arc flags may be packed ("a1 1 0 011 1"); they are
// read digit by digit.
export function parsePath(d) {
  const out = [];
  const s = String(d || "");
  let i = 0, cmd = null;
  const n = s.length;
  const skip = () => { while (i < n && /[\s,]/.test(s[i])) i++; };
  const number = () => {
    skip();
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(s);
    if (!m || m.index !== i || m[1]) return null;
    i = TOKEN.lastIndex;
    return Number(m[2]);
  };
  const flag = () => {
    skip();
    if (s[i] === "0" || s[i] === "1") return Number(s[i++]);
    return null;
  };
  while (true) {
    skip();
    if (i >= n) break;
    if (/[A-Za-z]/.test(s[i])) {
      cmd = s[i++];
      if (!(cmd.toLowerCase() in ARGS)) return out;   // not a path command: stop where we are
      if (cmd.toLowerCase() === "z") { out.push([cmd, []]); continue; }
    } else if (cmd === null) {
      return out;
    }
    const k = cmd.toLowerCase(), want = ARGS[k];
    if (!want) continue;
    const args = [];
    for (let j = 0; j < want; j++) {
      const v = k === "a" && (j === 3 || j === 4) ? flag() : number();
      if (v === null) return out;
      args.push(v);
    }
    out.push([cmd, args]);
    // Numbers after a moveto are linetos.
    if (cmd === "M") cmd = "L";
    else if (cmd === "m") cmd = "l";
  }
  return out;
}

// --------------------------------------------------------------- flattening

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function bezier(out, p0, p1, p2, p3, step) {
  const len = dist(p0, p1) + dist(p1, p2) + dist(p2, p3);
  const k = Math.max(2, Math.min(64, Math.ceil(len / step)));
  for (let j = 1; j <= k; j++) {
    const t = j / k, u = 1 - t;
    const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, e = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + e * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + e * p3[1]]);
  }
}

// SVG's endpoint arc as points (the spec's F.6.5 conversion to a centre).
function arc(out, p0, rx, ry, rot, large, sweep, p1, step) {
  if (dist(p0, p1) < 1e-9) return;
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9) { out.push(p1); return; }
  const phi = (rot * Math.PI) / 180, cp = Math.cos(phi), sp = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cp * dx + sp * dy, y1 = -sp * dx + cp * dy;
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let co = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) co = -co;
  const cx1 = (co * rx * y1) / ry, cy1 = (-co * ry * x1) / rx;
  const cx = cp * cx1 - sp * cy1 + (p0[0] + p1[0]) / 2, cy = sp * cx1 + cp * cy1 + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const t1 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  else if (sweep && dt < 0) dt += 2 * Math.PI;
  const k = Math.max(2, Math.min(96, Math.ceil((Math.abs(dt) * Math.max(rx, ry)) / step)));
  for (let j = 1; j <= k; j++) {
    const t = t1 + (dt * j) / k;
    const ex = rx * Math.cos(t), ey = ry * Math.sin(t);
    out.push([cp * ex - sp * ey + cx, sp * ex + cp * ey + cy]);
  }
  out[out.length - 1] = [p1[0], p1[1]];
}

// The path's contours as point lists in its own units: [{pts, closed}].
export function flatten(d, step = 0.35) {
  const contours = [];
  let pts = null, cur = [0, 0], start = [0, 0], ctrl = null, prev = "";
  const end = (closed) => {
    if (pts && pts.length > 1) contours.push({ pts, closed });
    pts = null;
  };
  for (const [cmd, a] of parsePath(d)) {
    const k = cmd.toLowerCase(), rel = cmd !== cmd.toUpperCase();
    const P = (x, y) => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (k === "m") {
      end(false);
      cur = P(a[0], a[1]);
      start = cur;
      pts = [cur];
    } else if (k === "z") {
      if (pts) { if (pts.length > 1 && dist(pts[pts.length - 1], start) < 1e-6) pts.pop(); end(true); }
      cur = start;
    } else {
      if (!pts) pts = [cur];
      if (k === "l") { cur = P(a[0], a[1]); pts.push(cur); }
      else if (k === "h") { cur = [rel ? cur[0] + a[0] : a[0], cur[1]]; pts.push(cur); }
      else if (k === "v") { cur = [cur[0], rel ? cur[1] + a[0] : a[0]]; pts.push(cur); }
      else if (k === "c" || k === "s") {
        let c1, c2, to;
        if (k === "c") { c1 = P(a[0], a[1]); c2 = P(a[2], a[3]); to = P(a[4], a[5]); }
        else {
          c1 = ctrl && "cs".includes(prev) ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur;
          c2 = P(a[0], a[1]); to = P(a[2], a[3]);
        }
        bezier(pts, cur, c1, c2, to, step);
        ctrl = c2; cur = to;
      } else if (k === "q" || k === "t") {
        let q, to;
        if (k === "q") { q = P(a[0], a[1]); to = P(a[2], a[3]); }
        else { q = ctrl && "qt".includes(prev) ? [2 * cur[0] - ctrl[0], 2 * cur[1] - ctrl[1]] : cur; to = P(a[0], a[1]); }
        // A quadratic as a cubic.
        const c1 = [cur[0] + (2 / 3) * (q[0] - cur[0]), cur[1] + (2 / 3) * (q[1] - cur[1])];
        const c2 = [to[0] + (2 / 3) * (q[0] - to[0]), to[1] + (2 / 3) * (q[1] - to[1])];
        bezier(pts, cur, c1, c2, to, step);
        ctrl = q; cur = to;
      } else if (k === "a") {
        const to = P(a[5], a[6]);
        arc(pts, cur, a[0], a[1], a[2], a[3], a[4], to, step);
        cur = to;
      }
    }
    if (!"cs".includes(k) && !"qt".includes(k)) ctrl = null;
    prev = k;
  }
  end(false);
  return contours;
}

// ----------------------------------------------------------------- strokes

// How solid a filled icon is: its outlines plus this much of its colour inside.
export const FILLS = { none: 0, soft: 0.3, solid: 1 };

// The icon's outlines in the box [-1, 1]², y up, centred on the viewBox.
// opts: {role: "line" | "accent" | "text", w: line weight (1 = the screen line),
// fill: "none" | "soft" | "solid"}. A filled icon's strokes share a `group`
// and `solid` (the fill's alpha): the card fills them as one shape, so its
// holes stay holes (nonzero winding, as the SVG is drawn).
export function pathStrokes(d, viewBox = VIEWBOX, opts = {}) {
  const vb = Array.isArray(viewBox) ? viewBox
    : String(viewBox || "").trim() ? String(viewBox).trim().split(/[\s,]+/).map(Number) : VIEWBOX;
  const [x0, y0, w, h] = vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0 ? vb : VIEWBOX;
  const half = Math.max(w, h) / 2, cx = x0 + w / 2, cy = y0 + h / 2;
  const role = opts.role || "line", wt = Number.isFinite(opts.w) ? opts.w : 1;
  const solid = FILLS[opts.fill] || 0, group = solid ? {} : null;
  // An icon is a filled shape, and SVG fill closes every subpath, Z or not
  // (mdi's sun leaves its rays open): so every outline is closed here too.
  return flatten(d, (Math.max(w, h) / 24) * 0.35).map(({ pts }) => ({
    pts: pts.map(([x, y]) => [(x - cx) / half, -(y - cy) / half]),
    closed: true, w: wt, role, fill: false, ...(group ? { group, solid } : {}),
  }));
}

// Strokes scaled by `s` and moved to (x, y): for placing an icon in a box.
export function placed(strokes, s, x = 0, y = 0) {
  return strokes.map((st) => ({ ...st, pts: st.pts.map(([px, py]) => [x + px * s, y + py * s]) }));
}

// ------------------------------------------------------------------ loading

const cache = new Map();     // name -> {path, viewBox} | null (unknown) | Promise
const strokeCache = new Map();
const warned = new Set();

const valid = (name) => typeof name === "string" && /^[a-z0-9_-]+:[a-z0-9_-]+$/i.test(name.trim());

// Off-DOM <ha-icon>: it looks the name up in HA's icon database (and custom
// iconsets) and renders an <ha-svg-icon> holding the path.
async function fromHa(name) {
  const def = customElements.whenDefined("ha-icon");
  const ok = await Promise.race([def.then(() => true), new Promise((r) => setTimeout(() => r(false), 4000))]);
  if (!ok) return null;
  const el = document.createElement("ha-icon");
  el.icon = name;
  el.style.cssText = "position:fixed;left:-9999px;top:0;width:24px;height:24px;pointer-events:none";
  document.body.appendChild(el);
  try {
    for (let i = 0; i < 60; i++) {
      const svg = el.shadowRoot?.querySelector("ha-svg-icon");
      if (svg?.path) return { path: svg.path, viewBox: svg.viewBox || null };
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  } finally {
    el.remove();
  }
}

export function iconPath(name) {
  name = String(name || "").trim();
  if (!valid(name)) return Promise.resolve(null);
  const hit = cache.get(name);
  if (hit !== undefined) return hit instanceof Promise ? hit : Promise.resolve(hit);
  const fixture = globalThis.ALFIE_ICONS?.[name];   // the harness, which has no HA
  const p = (fixture ? Promise.resolve({ path: fixture, viewBox: null })
    : typeof customElements !== "undefined" ? fromHa(name) : Promise.resolve(null))
    .catch(() => null)
    .then((r) => {
      cache.set(name, r);
      if (!r && !warned.has(name)) { warned.add(name); console.warn(`Alfie: no icon called ${name}`); }
      return r;
    });
  cache.set(name, p);
  return p;
}

export function strokesFor(name, opts = {}) {
  name = String(name || "").trim();
  const key = `${name}|${opts.role || "line"}|${opts.w ?? 1}|${opts.fill || "none"}`;
  const s = strokeCache.get(key);
  if (s) return s;
  const hit = cache.get(name);
  if (hit === undefined) { iconPath(name); return null; }
  if (!hit || hit instanceof Promise) return null;
  const out = pathStrokes(hit.path, hit.viewBox, opts);
  strokeCache.set(key, out);
  return out;
}

// True once a name is known not to resolve (or isn't an icon name at all).
export function failed(name) {
  name = String(name || "").trim();
  return !valid(name) || cache.get(name) === null;
}
