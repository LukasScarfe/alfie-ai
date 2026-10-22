// The night sky out of a window: stick-figure constellations, the five naked-eye
// planets each with its own mark, and the moon in phase, over a straight horizon.
// It faces a fixed bearing (south by default) or, in "auto", turns to whichever
// bearing has the most in view, chosen afresh every 15 minutes. Ports xy
// figures.py `_stars`. Positions are recomputed once a minute (memo), not per frame.
const V = (() => { try { return new URL(import.meta.url).search; } catch (_) { return ""; } })();
const K = await import(`../alfie-sky.js${V}`);
// Fetch the catalogue now so the first frame has it. In node the tests install it
// themselves, so a failed fetch is fine.
try { await K.loadConstellations(); } catch (_) { /* placeholder until installed */ }

const SLOT = 900, STEP = 15;             // the auto bearing: re-pick this often (s), from every STEP degrees
const FACE = { south: 180, north: 0, east: 90, west: 270 };
const Y0 = -0.45;                        // the horizon, as a fraction of the box half-height
const TOP = 1.5;                         // projected height of about 70 degrees overhead
const LINE = 0.45;                       // constellation lines are context: dimmer than the planets
const NAMES = { mercury: "Mercury", venus: "Venus", mars: "Mars", jupiter: "Jupiter", saturn: "Saturn" };
const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

const starR = (mag) => Math.max(0.004, Math.min(0.016, 0.0125 - 0.003 * (mag - 1)));

// Stereographic projection centred on the horizon straight ahead: it keeps a
// constellation's shape wherever it sits, and the horizon comes out straight.
// Returns [x, y] in projected units, or null below the horizon or behind us.
function project(alt, az, facing) {
  if (alt < 0) return null;
  const h = alt * Math.PI / 180, a = (((az - facing + 180) % 360 + 360) % 360 - 180) * Math.PI / 180;
  const c = Math.cos(h) * Math.cos(a);
  if (c < 0) return null;
  const k = 2 / (1 + c);
  return [k * Math.cos(h) * Math.sin(a), k * Math.sin(h)];
}

// The bearing with the most in view, from the planets and the moon (8 each) and
// the brighter constellation stars (more for brighter); south wins a tie.
function bestFacing(bodies, X, top) {
  let best = 180, bestScore = -1;
  for (let f = 0; f < 360; f += STEP) {
    let s = 0.01 * Math.cos((f - 180) * Math.PI / 180);
    for (const [alt, az, wt] of bodies) {
      const p = project(alt, az, f);
      if (p && Math.abs(p[0]) <= X && p[1] <= top) s += wt;
    }
    if (s > bestScore) { bestScore = s; best = f; }
  }
  return best;
}

export default {
  type: "stars",
  draw({ w, h, t, options, config, memo, S }) {
    const o = options ?? {};
    const loc = K.location(o, config);
    const cons = K.constellations();
    if (!loc || !cons) return S.text("Stars", 0.3 * h, 0, 0);
    const minute = Math.floor(t / 60);
    const key = `${minute}|${loc.lat}|${loc.lon}|${loc.tz}|${w.toFixed(3)}|${h.toFixed(3)}|${JSON.stringify(o)}`;
    if (memo.key === key) return memo.out;
    // Elements: the sky (the field, its horizon and names), the facing letter
    // and the time. The sky in a box of its own is drawn to fit it; the
    // letter and time follow it unless they have boxes of their own.
    const L = S.layout(w, h, o.layout);
    memo.boxes = L.boxes;
    const F = L.box("sky", S.rect(-w, -h, w, h)), fw = F.w / 2, fh = F.h / 2;

    const { lat, lon, tz } = loc;
    const fov = Number(o.fov) || 60;
    const X0 = 2 * Math.tan((fov / 2) * Math.PI / 180);  // projected half width for the field of view
    const y0 = Y0 * fh;
    // To box units. A wide box would stretch the picture until it lost the sky's
    // upper part, so it shows more than `fov` sideways instead (never less).
    const k = Math.min((0.92 * fw) / X0, (0.95 * fh - y0) / TOP);
    const X = (0.92 * fw) / k;                            // projected half width shown
    const top = (0.95 * fh - y0) / k;                     // projected top edge
    const nCons = Math.max(0, Math.min(cons.length, Math.round(Number(o.constellations) || 0)));
    const shown = cons.slice(0, nCons);
    const place = (alt, az, facing) => {
      const p = project(alt, az, facing);
      return p && Math.abs(p[0]) <= X && p[1] <= top ? [p[0] * k, y0 + p[1] * k] : null;
    };

    // Which way we look.
    let facing = FACE[o.facing] ?? 180;
    if (o.facing === "auto") {
      const slot = Math.floor(t / SLOT);
      if (memo.slotKey !== `${slot}|${lat}|${lon}|${fov}|${nCons}|${fw}|${fh}`) {
        const ts = slot * SLOT;
        const bodies = K.PLANETS.map((n) => [...K.planet(n, lat, lon, ts), 8]);
        bodies.push([...K.moon(lat, lon, ts), 8]);
        for (const c of shown) {
          const pts = c.lines.flat().filter((p) => p[2] <= 3.5);
          K.stars(pts, lat, lon, ts).forEach(([alt, az], i) => bodies.push([alt, az, 1 + 0.3 * (3.5 - pts[i][2])]));
        }
        memo.slotKey = `${slot}|${lat}|${lon}|${fov}|${nCons}|${fw}|${fh}`;
        memo.facing = bestFacing(bodies, X, top);
      }
      facing = memo.facing;
    }

    const out = [];
    const u = fh;                                           // sizes scale with the box height
    if (L.show("sky")) out.push(S.stroke([[-X * k, y0], [X * k, y0]], { w: 0.5 }));

    // Constellations: each run of a line that is in view, with a small loop on each
    // star the first time a line reaches it. Lines leaving the window are dropped whole.
    const dotK = Number(o.dot_size) || 1;
    const ts = Number(o.text_size) || 1;
    for (const c of L.show("sky") ? shown : []) {
      const aa = K.stars(c.lines.flat(), lat, lon, t);
      let i = 0, shownPts = [];
      const looped = new Set();
      for (const poly of c.lines) {
        let run = [];
        const flush = () => { if (run.length > 1) out.push(S.stroke(run, { w: LINE })); run = []; };
        for (const p of poly) {
          const [alt, az] = aa[i++];
          const xy = place(alt, az, facing);
          if (!xy) { flush(); continue; }
          run.push(xy);
          shownPts.push(xy);
          const id = `${p[0]},${p[1]}`;
          if (o.star_dots && !looped.has(id)) {
            looped.add(id);
            const r = starR(p[2]) * u * dotK;
            for (let j = 0; j <= 8; j++) run.push([xy[0] + r * Math.sin(2 * Math.PI * j / 8), xy[1] + r * Math.cos(2 * Math.PI * j / 8)]);
            run.push(xy);
          }
        }
        flush();
      }
      // The name over the figure, when it is wholly or mostly in view.
      if (o.labels && shownPts.length >= 3) {
        const cx = shownPts.reduce((s, p) => s + p[0], 0) / shownPts.length;
        const top2 = Math.max(...shownPts.map((p) => p[1]));
        const lh = 0.05 * u * ts;
        if (Math.abs(cx) < fw * 0.85 && top2 + 2.2 * lh < fh) out.push(...S.text(c.name, lh, cx, top2 + 1.6 * lh, { role: "dim", w: 0.8 }));
      }
    }

    if (o.planets && L.show("sky")) {
      for (const n of K.PLANETS) {
        const [alt, az] = K.planet(n, lat, lon, t);
        const xy = place(alt, az, facing);
        if (!xy) continue;
        out.push(...K.planetMark(n, xy[0], xy[1], 0.024 * u));
        if (o.labels) out.push(...S.text(NAMES[n], 0.045 * u * ts, xy[0], xy[1] - (0.0625 + 0.0225 * ts) * u, { role: "dim", w: 0.8 }));
      }
    }
    if (o.moon && L.show("sky")) {
      const [alt, az] = K.moon(lat, lon, t);
      const xy = place(alt, az, facing);
      if (xy) out.push(...K.moonStrokes(xy[0], xy[1], 0.045 * u, K.moonPhase(t), { fill: !!o.moon_fill, flip: lat < 0 }));
    }

    // Under the horizon: the bearing faced and the time.
    const below = y0 - (0.115 + 0.045 * ts) * u;
    const letter = o.labels && L.show("facing"), time = o.times && L.show("time");
    const both = letter && time && L.flow("facing") && L.flow("time");
    // Under the horizon, or in a box of its own.
    const under = (key, s, x) => {
      if (L.own(key)) {
        const B = L.box(key, null);
        return S.shift(S.fitText(s, B, B.h * Math.min(1, L.size(key)), { align: L.align(key) }), -F.cx, -F.cy);
      }
      const ht = 0.09 * u * ts * L.size(key), half = S.width(s, ht) / 2;
      L.box(key, S.rect(x - half + F.cx, below - ht * 0.6 + F.cy, x + half + F.cx, below + ht * 0.6 + F.cy));
      return S.text(s, ht, x, below);
    };
    if (letter) {
      const b = ((facing % 360) + 360) % 360;
      out.push(...under("facing", COMPASS[Math.round(b / 45) % 8], both ? -0.25 * u * Math.max(1, ts) : 0));
    }
    if (time) out.push(...under("time", K.clock(K.localHours(t, tz)), both ? 0.25 * u * Math.max(1, ts) : 0));
    memo.key = key; memo.out = S.shift(out, F.cx, F.cy);
    return memo.out;
  },
};
