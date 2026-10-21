// The Look tab's point editor for a `path` shape (design.md "Shapes are
// swappable data"): drag a corner, press on an edge to add one there,
// double-click a corner (or select it and press Remove) to take it out.
// It draws in the shape's own box, [-1, 1]² with y up: the corners and,
// behind them, the outline Alfie draws (rounded), at the corners' scale.
//
//   html(part, spec)                 -> the editor's markup
//   wire(el, {get, set, done})       -> pointer handling on one editor; get()
//                                       is the spec, set(spec) a live change,
//                                       done() the end of a drag
//   paint(el, spec)                  -> redraw it

const V = new URL(import.meta.url).search;
const Face = await import(`../alfie-face.js${V}`);

const MAX = 200;           // points; the config's limit
const MIN = 3;
const SNAP = 0.05;
const R = 0.055;           // handle radius, box units

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function html(part) {
  return `<div class="pathed" data-part="${esc(part)}">
    <svg viewBox="-1.25 -1.25 2.5 2.5" role="img" aria-label="Shape corners: drag to move, press an edge to add"></svg>
    <div class="row pathtools">
      <label class="check"><input type="checkbox" class="path-snap"> <span>Snap</span></label>
      <label class="check"><input type="checkbox" class="path-sym"> <span>Symmetric</span></label>
      <button class="flat" data-action="path-rm" data-part="${esc(part)}" disabled>Remove corner</button>
    </div>
    <small class="muted">Drag a corner. Press an edge to add one; double-click a corner to remove it.</small>
  </div>`;
}

const fmt = (v) => Math.round(v * 1000) / 1000;

export function paint(el, spec) {
  const svg = el.querySelector("svg");
  const pts = spec.points || [];
  const sel = Number(el.dataset.sel ?? -1);
  // The outline Alfie draws, back at the corners' scale (outline fits [-1, 1]).
  const m = Math.max(1e-6, ...pts.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
  let line = "";
  try {
    const o = Face.outline({ type: "path", points: pts, roundness: spec.roundness || 0 }, 120);
    line = o.map(([x, y]) => `${fmt(x * m)},${fmt(y * m)}`).join(" ");
  } catch (_) { /* fewer than 3 corners while editing */ }
  const segs = pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    return `<line class="seg" data-j="${i}" x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}"/>`;
  }).join("");
  const handles = pts.map(([x, y], i) => `<circle class="h${i === sel ? " sel" : ""}${i === 0 ? " first" : ""}" data-j="${i}" cx="${x}" cy="${y}" r="${R}"/>`).join("");
  svg.innerHTML = `<g transform="scale(1,-1)">
    <rect class="box" x="-1" y="-1" width="2" height="2"/>
    <line class="axis" x1="-1" y1="0" x2="1" y2="0"/><line class="axis" x1="0" y1="-1" x2="0" y2="1"/>
    <polygon class="shape" points="${line}"/>
    <polygon class="ctrl" points="${pts.map(([x, y]) => `${x},${y}`).join(" ")}"/>
    ${segs}${handles}</g>`;
  el.querySelector('[data-action="path-rm"]').disabled = !(sel >= 0 && pts.length > MIN);
}

// The pointer in box units, y up.
function at(svg, ev) {
  const pt = svg.createSVGPoint();
  pt.x = ev.clientX; pt.y = ev.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  return [p.x, -p.y];
}

const clampPt = ([x, y], snap) => {
  const c = (v) => Math.max(-1, Math.min(1, snap ? Math.round(v / SNAP) * SNAP : v));
  return [fmt(c(x)), fmt(c(y))];
};

// The mirror partner of corner j (x to -x), when the shape is symmetric: the
// corner nearest to j's mirror image, other than j itself (unless j is on the axis).
function partner(pts, j) {
  const [x, y] = pts[j];
  if (Math.abs(x) < 1e-3) return -1;
  let best = -1, d = Infinity;
  pts.forEach(([u, w], k) => {
    if (k === j) return;
    const e = Math.hypot(u + x, w - y);
    if (e < d) { d = e; best = k; }
  });
  return d < 0.15 ? best : -1;
}

export function wire(el, { get, set, done }) {
  const svg = el.querySelector("svg");
  let drag = -1, mate = -1;
  const snap = () => el.querySelector(".path-snap")?.checked;
  const sym = () => el.querySelector(".path-sym")?.checked;
  const points = () => (get().points || []).map((p) => p.slice());
  const commit = (pts) => set({ ...get(), points: pts });
  svg.addEventListener("pointerdown", (ev) => {
    const t = ev.target;
    if (!t.dataset || t.dataset.j === undefined) return;
    ev.preventDefault();
    let pts = points();
    let j = Number(t.dataset.j);
    if (t.classList.contains("seg")) {
      if (pts.length >= MAX) return;
      j += 1;
      pts.splice(j, 0, clampPt(at(svg, ev), snap()));
      commit(pts);
    }
    drag = j;
    mate = sym() ? partner(pts, j) : -1;
    el.dataset.sel = String(j);
    try { svg.setPointerCapture(ev.pointerId); } catch (_) { /* a synthetic pointer */ }
    paint(el, get());
  });
  svg.addEventListener("pointermove", (ev) => {
    if (drag < 0) return;
    const pts = points();
    const p = clampPt(at(svg, ev), snap());
    pts[drag] = p;
    if (mate >= 0 && mate < pts.length) pts[mate] = [fmt(-p[0]), p[1]];
    commit(pts);
    paint(el, get());
  });
  const end = () => { if (drag >= 0) { drag = -1; mate = -1; done(); } };
  svg.addEventListener("pointerup", end);
  svg.addEventListener("pointercancel", end);
  svg.addEventListener("dblclick", (ev) => {
    const j = Number(ev.target.dataset?.j);
    if (!ev.target.classList.contains("h") || !(j >= 0)) return;
    removeAt(el, j, { get, set, done });
  });
  paint(el, get());
}

export function removeAt(el, j, { get, set, done }) {
  const pts = (get().points || []).slice();
  if (pts.length <= MIN || !(j >= 0 && j < pts.length)) return;
  pts.splice(j, 1);
  el.dataset.sel = "-1";
  set({ ...get(), points: pts });
  paint(el, get());
  done();
}

export const STYLE = `
  .pathed svg { width: 100%; max-width: 280px; aspect-ratio: 1; display: block; margin: 4px auto; touch-action: none;
    background: var(--secondary-background-color); border-radius: 10px; }
  .pathed .box { fill: none; stroke: var(--divider-color, #444); stroke-width: 0.01; }
  .pathed .axis { stroke: var(--divider-color, #444); stroke-width: 0.006; stroke-dasharray: 0.04 0.04; }
  .pathed .shape { fill: color-mix(in srgb, var(--primary-color) 14%, transparent); stroke: var(--primary-color); stroke-width: 0.025; stroke-linejoin: round; }
  .pathed .ctrl { fill: none; stroke: var(--secondary-text-color); stroke-width: 0.008; stroke-dasharray: 0.03 0.03; }
  .pathed .seg { stroke: transparent; stroke-width: 0.09; cursor: copy; }
  .pathed .h { fill: var(--card-background-color, #222); stroke: var(--primary-text-color); stroke-width: 0.018; cursor: grab; }
  .pathed .h.first { stroke: var(--primary-color); }
  .pathed .h.sel { fill: var(--primary-color); }
  .pathtools { gap: 10px; flex-wrap: wrap; justify-content: center; }`;
