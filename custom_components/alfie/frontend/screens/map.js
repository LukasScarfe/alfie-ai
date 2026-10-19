// Streets around the home and chosen trackers (xy `_car_map` and `streets.py`).
// The provider sends clipped, simplified lat/lon polylines for one ~100 m cell;
// everything here is projection, clipping and placing, cached on `memo` and
// redone only when the centre, radius or box changes. With no streets (the
// fetch is off, failed or pending) the markers still draw.
const M_PER_DEG = 111320;
const RADII = [75, 95, 120, 150, 180, 210, 250, 290, 340, 400, 500];   // auto ladder, metres
const MAP_HALF = 0.9;        // the map's half height, as a share of the box
const HOME_GAP = 0.16;       // closest the house sits to a marker
const KINDS = ["diamond", "ring", "square"];
// Road class -> [weight, role]: arterials bold, streets normal, alleys dotted.
const ROAD = { motorway: [1.5, "line"], trunk: [1.5, "line"], primary: [1.3, "line"], secondary: [1.2, "line"],
  tertiary: [1.1, "line"], unclassified: [0.8, "dim"], residential: [0.8, "dim"], living_street: [0.8, "dim"], alley: [0.15, "dim"] };

const ok = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && (lat !== 0 || lon !== 0);

export function metres(a, b) {
  const k = Math.cos(((a[0] + b[0]) / 2 * Math.PI) / 180);
  return Math.hypot((a[0] - b[0]) * M_PER_DEG, (a[1] - b[1]) * M_PER_DEG * k);
}

// Liang-Barsky: the part of a-b inside |x| <= w, |y| <= h, or null.
export function clipSegment(a, b, w, h) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a[0] + w], [dx, w - a[0]], [-dy, a[1] + h], [dy, h - a[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t); else t1 = Math.min(t1, t);
    if (t0 > t1) return null;
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

// A polyline cut to the box: the runs of it that are inside.
export function clip(pts, w, h) {
  const runs = [];
  let cur = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = clipSegment(pts[i], pts[i + 1], w, h);
    if (!seg) { if (cur.length > 1) runs.push(cur); cur = []; continue; }
    const last = cur[cur.length - 1];
    if (!last || Math.hypot(last[0] - seg[0][0], last[1] - seg[0][1]) > 1e-9) {
      if (cur.length > 1) runs.push(cur);
      cur = [seg[0]];
    }
    cur.push(seg[1]);
    if (seg[1][0] !== pts[i + 1][0] || seg[1][1] !== pts[i + 1][1]) { runs.push(cur); cur = []; }
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

// Where trackers and home sit: metres from the centre scaled by `k` (units per
// metre). A far one is pinned to the box's edge, in its direction.
export function place(p, centre, k, bw, bh, pin = false) {
  let x = (p[1] - centre[1]) * k * M_PER_DEG * Math.cos((centre[0] * Math.PI) / 180);
  let y = (p[0] - centre[0]) * k * M_PER_DEG;
  const over = Math.max(Math.abs(x) / bw, Math.abs(y) / bh);
  if (pin && over > 1) { x /= over; y /= over; }
  return [x, y];
}

// The smallest ladder radius that holds every point inside 80% of the map.
export function autoRadius(centre, points) {
  const need = Math.max(0, ...points.map((p) => metres(centre, p) / 0.8));
  return RADII.find((r) => r >= need && r >= 150) ?? RADII[RADII.length - 1];
}

// Distinct initials: the name's first unused letter, else the tracker's number.
export function initials(names, S) {
  const used = new Set();
  return names.map((n, i) => {
    const letters = [...S.title(n).toUpperCase()].filter((c) => /[A-Z]/.test(c));
    const pick = letters.find((c) => !used.has(c)) ?? String(i + 1);
    used.add(pick);
    return pick;
  });
}

function trackerInfo(id, states) {
  const st = states?.[id];
  const lat = Number(st?.attributes?.latitude), lon = Number(st?.attributes?.longitude);
  return ok(lat, lon) ? { id, pos: [lat, lon], name: st.attributes.friendly_name || id.split(".")[1] || id } : null;
}

// Street strokes in face units for one centre and box; cached by the caller.
export function streetStrokes(data, centre, k, bw, bh, S) {
  const kx = k * M_PER_DEG * Math.cos((centre[0] * Math.PI) / 180), ky = k * M_PER_DEG;
  const out = [];
  for (const [kind, flat] of data?.ways ?? []) {
    const pts = [];
    for (let i = 0; i + 1 < flat.length; i += 2) pts.push([(flat[i + 1] - centre[1]) * kx, (flat[i] - centre[0]) * ky]);
    const [w, role] = ROAD[kind] ?? [0.8, "dim"];
    for (const run of clip(pts, bw, bh)) out.push(S.stroke(run, { w, role }));
  }
  return out;
}

export default {
  type: "map",
  draw({ w, h, data, options, states, config, memo, S }) {
    const o = options;
    const found = (o.trackers ?? []).map((id) => trackerInfo(id, states)).filter(Boolean);
    const home = ok(Number(config?.latitude), Number(config?.longitude)) ? [Number(config.latitude), Number(config.longitude)] : null;
    const title = S.title(o.title ?? "");
    const unit = Math.min(w, h);                       // marker sizes scale with the smaller side
    const ts = Number(o.text_size) || 1;
    const bw = w - 0.06 * unit, bh = h - 0.06 * unit;   // markers stay this far inside the edge
    const centre = found.length ? found[0].pos : home;
    if (!centre) return S.text(title || "--", 0.2 * unit);

    const near = found.filter((f) => metres(centre, f.pos) < 2 * 500);
    const radius = o.radius > 0 ? o.radius : autoRadius(centre, [...near.map((f) => f.pos), ...(o.show_home && home && metres(centre, home) < 500 ? [home] : [])].slice(0, 6));
    const k = (MAP_HALF * unit) / radius;               // units per metre; wide boxes show more east-west

    const key = [data ? data.cell?.join(",") + ":" + (data.ways?.length ?? 0) : "-", centre[0].toFixed(5), centre[1].toFixed(5), radius, w.toFixed(3), h.toFixed(3)].join("|");
    if (memo.key !== key) {
      memo.key = key;
      memo.streets = data ? streetStrokes(data, centre, k, w * 0.97, h * 0.97, S) : [];
    }
    const out = [...memo.streets];

    const letters = initials(found.map((f) => f.name), S);
    let spots = found.map((f) => place(f.pos, centre, k, bw, bh, true));
    if (spots.length === 2 && Math.hypot(spots[0][0] - spots[1][0], spots[0][1] - spots[1][1]) < 0.16 * unit) {
      // Side by side: at map scale the markers would overlap, so set them apart.
      const mx = (spots[0][0] + spots[1][0]) / 2, my = (spots[0][1] + spots[1][1]) / 2;
      spots = [[mx - 0.09 * unit, my], [mx + 0.09 * unit, my]];
    }
    spots.forEach((s, i) => {
      const size = (i === 0 ? 0.16 : 0.13) * unit;
      out.push(...S.marker(KINDS[i % KINDS.length], s[0], s[1], size, { role: "accent" }));
      if (o.labels) out.push(...S.text(letters[i], size * 0.5 * Math.min(ts, 1.3), s[0], s[1], { role: "accent" }));
    });

    if (o.show_home && home) {
      let [hx, hy] = place(home, centre, k, bw, bh);
      const close = spots.filter((p) => Math.hypot(p[0] - hx, p[1] - hy) < HOME_GAP * unit);
      if (close.length) {
        // At home: push the house off the markers, away from them.
        const mx = close.reduce((a, p) => a + p[0], 0) / close.length, my = close.reduce((a, p) => a + p[1], 0) / close.length;
        const d = Math.hypot(hx - mx, hy - my);
        const [ux, uy] = d > 1e-6 ? [(hx - mx) / d, (hy - my) / d] : [0, -1];
        hx = mx + ux * HOME_GAP * unit; hy = my + uy * HOME_GAP * unit;
      }
      if (Math.abs(hx) < w - 0.08 * unit && Math.abs(hy) < h - 0.08 * unit) out.push(...S.house(hx, hy, 0.16 * unit));
    }
    if (title) out.push(...S.text(title, 0.07 * unit * ts, 0, h - (0.03 + 0.07 * ts) * unit));
    return out;
  },
};
